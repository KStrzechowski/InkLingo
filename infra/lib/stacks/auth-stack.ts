import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { createHash } from 'node:crypto';
import { AuthConstruct } from '../constructs/auth-construct';
import { CDK_SSM_PARAMS } from '../cdk-ssm-params';

// Must match browser_specific_settings.gecko.id in extension/manifest.json.
const FIREFOX_EXTENSION_ID = 'inklingo@inklingo.app';

// The redirect URI the Firefox extension authenticates with. Firefox's
// identity API derives it from the add-on ID as
// https://<sha1(id)>.extensions.allizom.org/ and launchWebAuthFlow
// refuses any other value, so this is computed rather than hardcoded —
// it has to stay identical to what extension/src/auth.ts gets back from
// browser.identity.getRedirectURL() at runtime. A moz-extension:// URL
// can't be used instead: that UUID is regenerated on every install.
function firefoxExtensionRedirectUrl (extensionId: string): string {
  const hash = createHash('sha1').update(extensionId).digest('hex');
  return `https://${hash}.extensions.allizom.org/`;
}

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
      additionalCallbackUrls: [
        `https://${cloudFrontDomain}/callback`,
        firefoxExtensionRedirectUrl(FIREFOX_EXTENSION_ID)
      ],
      // No extension entry: the extension's logout is local-only (it just
      // drops the tokens in browser.storage.local), so it never redirects
      // through Cognito's /logout endpoint.
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
