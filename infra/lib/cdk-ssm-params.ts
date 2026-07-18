// Well-known SSM Parameter Store paths used ONLY for CDK cross-stack
// wiring (resolved by CloudFormation at deploy time via
// ssm.StringParameter.valueForStringParameter). Deliberately namespaced
// under /ink-lingo-cdk/, separate from the app's own runtime secrets at
// /ink-lingo/* (Neon connection string, Anthropic API key) — so the
// Lambda's ssm:GetParameter IAM grant (scoped to /ink-lingo/*) never
// overlaps with these.
//
// One source of truth shared between the stack that publishes a value
// and every stack that reads it back, so a typo can't silently produce
// two different path strings.
export const CDK_SSM_PARAMS = {
  authUserPoolId: '/ink-lingo-cdk/auth/user-pool-id',
  authUserPoolClientId: '/ink-lingo-cdk/auth/user-pool-client-id'
} as const;
