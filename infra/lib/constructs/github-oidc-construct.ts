import { Construct } from 'constructs';
import { Stack } from 'aws-cdk-lib/core';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface GithubOidcConstructProps {
  githubOrg: string;
  githubRepo: string;
  // GitHub's immutable numeric owner/repo IDs (rolled out 2026-04-23:
  // https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/).
  // This repo is on the new format, confirmed via CloudTrail — the real
  // `sub` claim GitHub sends is `repo:OWNER@OWNER_ID/REPO@REPO_ID:...`,
  // not the plain `repo:OWNER/REPO:...` most existing tutorials assume.
  // Pinning to these IDs (not just names) is the security upgrade this
  // GitHub feature is actually for: names can be renamed/transferred,
  // IDs can't, so this is what protects the trust policy from a
  // repo-rename hijack, not merely what makes matching work.
  githubOrgId: string;
  githubRepoId: string;
}

const CDK_BOOTSTRAP_QUALIFIER = 'hnb659fds';

export class GithubOidcConstruct extends Construct {
  public readonly deployRole: iam.Role;
  public readonly diffRole: iam.Role;

  constructor (scope: Construct, id: string, props: GithubOidcConstructProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const repoSlug = `${props.githubOrg}@${props.githubOrgId}/${props.githubRepo}@${props.githubRepoId}`;

    // Confirmed via `aws iam list-open-id-connect-providers` before
    // writing this that no GitHub provider exists yet in this account —
    // if that's ever no longer true (e.g. a second project already
    // registered it), swap this for
    // iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(...) instead,
    // since AWS allows only one provider per URL per account.
    const provider = new iam.OpenIdConnectProvider(this, 'GithubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com']
    });

    // The roles `cdk bootstrap` already created in this account/region —
    // assuming these (not a hand-rolled duplicate of CloudFormation/
    // Lambda/APIGW/S3/etc. permissions) is the standard, correct
    // CDK+OIDC pattern. Image-publishing-role is omitted: this app has
    // no Docker/ECR assets (Lambda is packaged as a zip).
    const cdkBootstrapRoleArns = [
      `arn:aws:iam::${account}:role/cdk-${CDK_BOOTSTRAP_QUALIFIER}-deploy-role-${account}-${region}`,
      `arn:aws:iam::${account}:role/cdk-${CDK_BOOTSTRAP_QUALIFIER}-file-publishing-role-${account}-${region}`,
      `arn:aws:iam::${account}:role/cdk-${CDK_BOOTSTRAP_QUALIFIER}-lookup-role-${account}-${region}`
    ];

    // Trust condition scoped to pushes on main only — GitHub's `sub`
    // claim format differs for branch-ref vs. pull_request runs, so this
    // will never match a PR-triggered run.
    this.deployRole = new iam.Role(this, 'GitHubActionsDeployRole', {
      roleName: 'GitHubActionsDeployRole',
      assumedBy: new iam.OpenIdConnectPrincipal(provider, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: { 'token.actions.githubusercontent.com:sub': `repo:${repoSlug}:ref:refs/heads/main` }
      }),
      description: 'Assumed by GitHub Actions on pushes to main to run cdk deploy'
    });
    this.deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: cdkBootstrapRoleArns
    }));

    // Separate role, not a widened trust on deployRole: widening
    // deployRole to also cover `pull_request` would let any PR —
    // including future ones from less-trusted contributors — assume a
    // role that can actually deploy.
    //
    // This role must NOT be able to assume the cdk-*-deploy-role or
    // cdk-*-file-publishing-role: those grant effectively full
    // CloudFormation/IAM/S3/Lambda permissions, so `sts:AssumeRole` on
    // them is a deploy capability regardless of what the workflow *says*
    // it runs (`cdk diff` vs `cdk deploy` is just a CLI arg — nothing at
    // the IAM layer enforces it). A PR that gets arbitrary code to run in
    // this job (e.g. via a malicious postinstall script) would otherwise
    // be able to `cdk deploy` with these credentials.
    //
    // `cdk diff` only needs to (a) read the deployed stack's template to
    // compare against, and (b) resolve context lookups (AZs, SSM params,
    // etc.) via the bootstrap lookup-role, which is intentionally
    // provisioned as read-only.
    this.diffRole = new iam.Role(this, 'GitHubActionsDiffRole', {
      roleName: 'GitHubActionsDiffRole',
      assumedBy: new iam.OpenIdConnectPrincipal(provider, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        // Both trigger contexts that actually run `cdk diff` with this
        // role: pr-diff.yml (sub ends in `:pull_request`) and
        // deploy.yml's own pre-approval diff job, which runs on a push
        // to main (sub is `:ref:refs/heads/main` there, same as the
        // deploy role's condition) — safe to grant both since this
        // role's attached permissions stay read-only-only either way.
        StringLike: {
          'token.actions.githubusercontent.com:sub': [
            `repo:${repoSlug}:pull_request`,
            `repo:${repoSlug}:ref:refs/heads/main`
          ]
        }
      }),
      description: 'Assumed by GitHub Actions on PRs and pushes to main to run cdk diff (read-only)'
    });
    this.diffRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: [cdkBootstrapRoleArns[2]] // lookup-role only, read-only by design
    }));
    // Wildcarded across all stacks in the account/region, not pinned to
    // today's three — these actions are read-only (Describe*/GetTemplate/
    // List*), so widening the resource scope only lets the role read
    // metadata for future stacks too; it can't create, modify, or delete
    // anything. Pinning to explicit stack ARNs here would mean redeploying
    // GithubOidcStack every time a new stack is added, for no real
    // security benefit given these actions can't mutate state.
    this.diffRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'cloudformation:DescribeStacks',
        'cloudformation:GetTemplate',
        'cloudformation:DescribeStackEvents',
        'cloudformation:ListStacks'
      ],
      resources: [`arn:aws:cloudformation:${region}:${account}:stack/*/*`]
    }));
  }
}
