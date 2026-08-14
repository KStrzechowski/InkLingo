import { Construct } from 'constructs';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'node:path';
import { CDK_SSM_PARAMS } from '../cdk-ssm-params';

export interface ApiConstructProps {
  // Overrides the SSM-derived CloudFront origin below — mainly for
  // local/manual testing; leave unset in normal deploys.
  allowedOrigin?: string;
}

// AWS Lambda Web Adapter — pinned exact version, never `:latest`.
// https://github.com/awslabs/aws-lambda-web-adapter/releases
function lwaLayerArn (region: string): string {
  return `arn:aws:lambda:${region}:753240598075:layer:LambdaAdapterLayerX86:28`;
}

export class ApiConstruct extends Construct {
  public readonly httpApi: apigatewayv2.HttpApi;
  public readonly lambdaFunction: lambda.Function;

  constructor (scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;

    // Resolved by CloudFormation at this stack's own deploy time — no
    // custom lookup code, no props from bin/infra.ts. AuthStack/
    // FrontendStack must have been deployed at least once so the
    // parameters exist.
    const userPoolId = ssm.StringParameter.valueForStringParameter(this, CDK_SSM_PARAMS.authUserPoolId);
    const userPoolClientId = ssm.StringParameter.valueForStringParameter(
      this, CDK_SSM_PARAMS.authUserPoolClientId
    );
    const cloudFrontDomain = ssm.StringParameter.valueForStringParameter(
      this, CDK_SSM_PARAMS.frontendCloudFrontDomain
    );
    const allowedOrigin = props.allowedOrigin ?? `https://${cloudFrontDomain}`;

    const userPool = cognito.UserPool.fromUserPoolId(this, 'ImportedUserPool', userPoolId);
    const userPoolClient = cognito.UserPoolClient.fromUserPoolClientId(
      this, 'ImportedUserPoolClient', userPoolClientId
    );

    // CDK's default LogGroup removal policy is RETAIN — overridden for
    // this disposable PoC stack so `cdk destroy ApiStack` doesn't leave
    // an orphaned log group behind. Short retention too, since nothing
    // here needs indefinite log history.
    const logGroup = new logs.LogGroup(this, 'BackendFunctionLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY
    });

    this.lambdaFunction = new lambda.Function(this, 'BackendFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.X86_64,
      // Staged by scripts/package-backend.mjs before synth/deploy — a
      // plain npm-installable package, not esbuild-bundled, so
      // @fastify/autoload's directory scan survives.
      code: lambda.Code.fromAsset(path.join(__dirname, '..', '..', '.build', 'lambda')),
      handler: 'run.sh',
      logGroup,
      layers: [
        lambda.LayerVersion.fromLayerVersionArn(this, 'LwaLayer', lwaLayerArn(region))
      ],
      timeout: Duration.seconds(29), // API Gateway HTTP API's own hard cap
      memorySize: 256,
      // The risk register calls for reserved concurrency as a free,
      // precise circuit breaker on request floods — but this account's
      // actual Lambda concurrency limit in eu-central-1 is only 10 total
      // (confirmed via `aws lambda get-account-settings`), and AWS
      // requires 10 to always stay unreserved. There's no room to
      // reserve anything until that quota is raised (a standard AWS
      // Support request) — API Gateway's own throttling below is the
      // only blast-radius cap in effect until then.
      environment: {
        AWS_LWA_PORT: '8080',
        PORT: '8080',
        AWS_LWA_READINESS_CHECK_PATH: '/health',
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
        NODE_ENV: 'production',
        COGNITO_USER_POOL_ID: userPoolId,
        COGNITO_CLIENT_ID: userPoolClientId,
        ALLOWED_ORIGIN: allowedOrigin
      }
    });

    this.lambdaFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${region}:${account}:parameter/ink-lingo/*`]
    }));

    // userPoolClients passed explicitly — omitting it makes the
    // authorizer accept tokens from *any* client in the pool, not just
    // this app's.
    const authorizer = new HttpUserPoolAuthorizer('CognitoAuthorizer', userPool, {
      userPoolClients: [userPoolClient]
    });

    this.httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: 'ink-lingo-api',
      // Every route is gated by this authorizer unless it explicitly
      // opts out (see /health below) — secure by default, no per-route
      // wiring needed. Defense-in-depth on top of the app-level JWT
      // verification (routes/api/autohooks.ts, backend), which remains
      // the sole source of `request.authUser`/JIT user-provisioning —
      // this authorizer only rejects bad tokens earlier, at the edge.
      defaultAuthorizer: authorizer,
      corsPreflight: {
        allowOrigins: [allowedOrigin],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.OPTIONS
        ],
        allowHeaders: ['authorization', 'content-type'],
        // Without this the browser hides x-request-id from page JS, so a
        // client error report can never carry the correlation id that joins
        // it to the backend's own log line for the same failure. The local
        // path needs the matching @fastify/cors entry (backend/src/plugins/
        // cors.ts).
        exposeHeaders: ['x-request-id']
      }
    });

    // L2 HttpStage has no throttle props yet — escape hatch onto the
    // underlying CfnStage for defaultRouteSettings.
    const cfnStage = this.httpApi.defaultStage!.node.defaultChild as apigatewayv2.CfnStage;
    cfnStage.defaultRouteSettings = {
      throttlingBurstLimit: 10,
      throttlingRateLimit: 5
    };

    const integration = new HttpLambdaIntegration('BackendIntegration', this.lambdaFunction);

    // Explicit paths, not a {proxy+} catch-all — simpler to verify each
    // route individually as they're added.
    // The one deliberate public route: explicitly opts out of
    // defaultAuthorizer so external health checks don't need a token.
    this.httpApi.addRoutes({
      path: '/health',
      methods: [apigatewayv2.HttpMethod.GET],
      integration,
      authorizer: new apigatewayv2.HttpNoneAuthorizer()
    });

    // No explicit authorizer here — inherits defaultAuthorizer above.
    // App-level JWT verification (routes/api/autohooks.ts, backend)
    // still runs behind it for JIT user-provisioning/`request.authUser`;
    // the CDK authorizer is an added edge-layer gate, not a replacement.
    this.httpApi.addRoutes({
      path: '/api/me',
      methods: [apigatewayv2.HttpMethod.GET],
      integration
    });

    this.httpApi.addRoutes({
      path: '/api/collections',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST],
      integration
    });

    this.httpApi.addRoutes({
      path: '/api/collections/{id}',
      methods: [apigatewayv2.HttpMethod.GET],
      integration
    });

    // Sub-resources need their own entries — HTTP API route keys match a
    // full path template, so /api/collections/{id} does not cover
    // anything below it.
    this.httpApi.addRoutes({
      path: '/api/collections/{id}/translate',
      methods: [apigatewayv2.HttpMethod.POST],
      integration
    });

    this.httpApi.addRoutes({
      path: '/api/collections/{id}/entries',
      methods: [apigatewayv2.HttpMethod.POST],
      integration
    });

    // FR-018's per-entry language backfill. Two levels below
    // /api/collections/{id}, so neither of the entries above covers it.
    this.httpApi.addRoutes({
      path: '/api/collections/{id}/entries/{entryId}/translations',
      methods: [apigatewayv2.HttpMethod.POST],
      integration
    });

    // Where the frontend and extension deliver their buffered error reports.
    // Authenticated like the rest of /api — a client whose session is dead
    // buffers instead, and flushes once it recovers.
    this.httpApi.addRoutes({
      path: '/api/client-errors',
      methods: [apigatewayv2.HttpMethod.POST],
      integration
    });
  }
}
