import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'node:path';
import { CDK_SSM_PARAMS } from '../cdk-ssm-params';

export interface ApiConstructProps {
  // Tightened to the real CloudFront domain once frontend-construct.ts
  // exists; defaults to '*' so local dev keeps working meanwhile.
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
    const allowedOrigin = props.allowedOrigin ?? '*';

    // Resolved by CloudFormation at this stack's own deploy time — no
    // custom lookup code, no props from bin/infra.ts. AuthStack must
    // have been deployed at least once so the parameters exist.
    const userPoolId = ssm.StringParameter.valueForStringParameter(this, CDK_SSM_PARAMS.authUserPoolId);
    const userPoolClientId = ssm.StringParameter.valueForStringParameter(
      this, CDK_SSM_PARAMS.authUserPoolClientId
    );

    const userPool = cognito.UserPool.fromUserPoolId(this, 'ImportedUserPool', userPoolId);
    const userPoolClient = cognito.UserPoolClient.fromUserPoolClientId(
      this, 'ImportedUserPoolClient', userPoolClientId
    );

    this.lambdaFunction = new lambda.Function(this, 'BackendFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.X86_64,
      // Staged by scripts/package-backend.mjs before synth/deploy — a
      // plain npm-installable package, not esbuild-bundled, so
      // @fastify/autoload's directory scan survives.
      code: lambda.Code.fromAsset(path.join(__dirname, '..', '..', '.build', 'lambda')),
      handler: 'run.sh',
      layers: [
        lambda.LayerVersion.fromLayerVersionArn(this, 'LwaLayer', lwaLayerArn(region))
      ],
      timeout: Duration.seconds(29), // API Gateway HTTP API's own hard cap
      memorySize: 256,
      // The free, precise circuit breaker from the risk register — caps
      // both blast radius and worst-case AWS bill of a request flood.
      reservedConcurrentExecutions: 5,
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

    this.httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: 'ink-lingo-api',
      corsPreflight: {
        allowOrigins: [allowedOrigin],
        allowMethods: [apigatewayv2.CorsHttpMethod.GET, apigatewayv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['authorization', 'content-type']
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

    // Explicit paths, not a {proxy+} catch-all — simpler to verify with
    // exactly two known routes at this stage.
    this.httpApi.addRoutes({
      path: '/health',
      methods: [apigatewayv2.HttpMethod.GET],
      integration
    });

    // userPoolClients passed explicitly — omitting it makes the
    // authorizer accept tokens from *any* client in the pool, not just
    // this app's.
    const authorizer = new HttpUserPoolAuthorizer('CognitoAuthorizer', userPool, {
      userPoolClients: [userPoolClient]
    });

    this.httpApi.addRoutes({
      path: '/api/ping',
      methods: [apigatewayv2.HttpMethod.GET],
      integration,
      authorizer
    });
  }
}
