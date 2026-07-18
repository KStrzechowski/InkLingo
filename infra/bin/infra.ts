#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AuthStack } from '../lib/stacks/auth-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { buildSelectedStacks } from '../lib/stack-selector';

// eu-central-1 (Frankfurt): the sole user is in Poland, and
// Lambda/API Gateway/Cognito aren't edge-distributed like CloudFront is,
// so the workload region is what actually determines API latency. Neon's
// project lives in the matching aws-eu-central-1 region.
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'eu-central-1' };

const app = new cdk.App();

buildSelectedStacks(app, {
  factories: {
    AuthStack: () => new AuthStack(app, 'AuthStack', { env }),
    ApiStack: () => new ApiStack(app, 'ApiStack', { env })
  },
  // ApiStack reads AuthStack's output via SSM Parameter Store (not a
  // live construct reference), so CDK can't auto-detect this ordering —
  // see lib/stack-selector.ts.
  dependencies: {
    ApiStack: ['AuthStack']
  }
});
