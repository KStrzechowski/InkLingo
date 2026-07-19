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

// Applies to every resource in every stack under this app (CDK's Tags
// aspect propagates down the whole construct tree) — this is what makes
// "everything built for InkLingo, and what it costs" answerable via
// Resource Groups / Cost Explorer, not just something visible from the
// stack list. Activating this as a Cost Allocation Tag in Billing
// preferences (one-time, console or `aws ce
// update-cost-allocation-tags-status`) is what makes it show up broken
// out in Cost Explorer specifically — tagging alone doesn't do that.
cdk.Tags.of(app).add('Project', 'InkLingo');

// CloudFormation stack name prefix — same reasoning, but for the stack
// list itself: without this, "FrontendStack"/"AuthStack"/etc. are
// generic enough to be ambiguous the moment this account ever hosts a
// second project.
const STACK_PREFIX = 'InkLingo-';

buildSelectedStacks(app, {
  factories: {
    FrontendStack: () => new FrontendStack(app, `${STACK_PREFIX}FrontendStack`, { env }),
    AuthStack: () => new AuthStack(app, `${STACK_PREFIX}AuthStack`, { env }),
    ApiStack: () => new ApiStack(app, `${STACK_PREFIX}ApiStack`, { env }),
    GithubOidcStack: () => new GithubOidcStack(app, `${STACK_PREFIX}GithubOidcStack`, { env })
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
