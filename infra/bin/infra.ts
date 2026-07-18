#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AuthStack } from '../lib/stacks/auth-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack';
import { GithubOidcStack } from '../lib/stacks/github-oidc-stack';
import { buildSelectedStacks } from '../lib/stack-selector';

// eu-central-1 (Frankfurt): the sole user is in Poland, and
// Lambda/API Gateway/Cognito aren't edge-distributed like CloudFront is,
// so the workload region is what actually determines API latency. Neon's
// project lives in the matching aws-eu-central-1 region.
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'eu-central-1' };

const app = new cdk.App();

buildSelectedStacks(app, {
  factories: {
    FrontendStack: () => new FrontendStack(app, 'FrontendStack', { env }),
    AuthStack: () => new AuthStack(app, 'AuthStack', { env }),
    ApiStack: () => new ApiStack(app, 'ApiStack', { env }),
    GithubOidcStack: () => new GithubOidcStack(app, 'GithubOidcStack', { env })
  },
  // Both AuthStack (callback URLs) and ApiStack (CORS origin) read
  // FrontendStack's CloudFront domain via SSM Parameter Store, and
  // ApiStack separately reads AuthStack's Cognito IDs the same way —
  // none of these are live construct references, so CDK can't
  // auto-detect the ordering. See lib/stack-selector.ts.
  dependencies: {
    AuthStack: ['FrontendStack'],
    ApiStack: ['AuthStack', 'FrontendStack']
  }
});
