import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { AuthConstruct } from '../constructs/auth-construct';
import { CDK_SSM_PARAMS } from '../cdk-ssm-params';

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly hostedUiDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Same SSM cross-stack pattern as ApiStack reading this stack's own
    // outputs — resolved by CloudFormation at THIS stack's deploy time,
    // so FrontendStack must have been deployed at least once already.
    const cloudFrontDomain = ssm.StringParameter.valueForStringParameter(
      this, CDK_SSM_PARAMS.frontendCloudFrontDomain
    );

    const auth = new AuthConstruct(this, 'Auth', {
      additionalCallbackUrls: [`https://${cloudFrontDomain}/callback`],
      additionalLogoutUrls: [`https://${cloudFrontDomain}/`]
    });
    this.userPool = auth.userPool;
    this.userPoolClient = auth.userPoolClient;
    this.hostedUiDomain = auth.hostedUiDomain;

    // CfnOutputs: for humans (console/CLI) and external scripts (e.g.
    // Phase 3's write-frontend-env.mjs reading `describe-stacks`).
    new cdk.CfnOutput(this, 'UserPoolId', { value: auth.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: auth.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'CognitoHostedUiDomain', { value: auth.hostedUiDomain.baseUrl() });

    // SSM parameters: for other CDK stacks (e.g. ApiStack) to consume
    // natively via ssm.StringParameter.valueForStringParameter — no
    // custom AWS SDK lookups, no props threaded through bin/infra.ts,
    // resolved by CloudFormation itself at the *consuming* stack's
    // deploy time.
    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: CDK_SSM_PARAMS.authUserPoolId,
      stringValue: auth.userPool.userPoolId
    });
    new ssm.StringParameter(this, 'UserPoolClientIdParam', {
      parameterName: CDK_SSM_PARAMS.authUserPoolClientId,
      stringValue: auth.userPoolClient.userPoolClientId
    });
  }
}
