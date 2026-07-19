import { Construct } from 'constructs';
import { RemovalPolicy, Stack } from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';

export interface AuthConstructProps {
  // Extra callback/logout URLs beyond localhost dev (e.g. the CloudFront
  // domain, wired in once frontend-construct.ts exists).
  additionalCallbackUrls?: string[];
  additionalLogoutUrls?: string[];
}

export class AuthConstruct extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly hostedUiDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: AuthConstructProps = {}) {
    super(scope, id);

    const account = Stack.of(this).account;

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'ink-lingo-users',
      signInAliases: { email: true },
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true }
      },
      // CDK's default for UserPool is RETAIN (protects real user data
      // from accidental deletion) — deliberately overridden for this
      // disposable PoC stack, matching the S3 bucket's DESTROY policy in
      // frontend-construct.ts, so `cdk destroy AuthStack` actually tears
      // the pool down instead of leaving it orphaned.
      removalPolicy: RemovalPolicy.DESTROY
    });

    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      // Explicit, not default: a client secret on a browser SPA is a
      // real, common misconfiguration since browsers can't keep it
      // confidential.
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: ['http://localhost:5173/callback', ...(props.additionalCallbackUrls ?? [])],
        logoutUrls: ['http://localhost:5173/', ...(props.additionalLogoutUrls ?? [])]
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO]
    });

    // Hosted-UI domain prefixes are globally unique across every AWS
    // account in the region — a bare "ink-lingo" prefix will very likely
    // collide with someone else's, so suffix with the account ID.
    this.hostedUiDomain = this.userPool.addDomain('HostedUiDomain', {
      cognitoDomain: { domainPrefix: `ink-lingo-${account}` }
    });
  }
}
