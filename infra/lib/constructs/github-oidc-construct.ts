import { Construct } from 'constructs';
import { Stack } from 'aws-cdk-lib/core';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface GithubOidcConstructProps {
  githubOrg: string;
  githubRepo: string;
}

const CDK_BOOTSTRAP_QUALIFIER = 'hnb659fds';

export class GithubOidcConstruct extends Construct {
  public readonly deployRole: iam.Role;
  public readonly diffRole: iam.Role;

  constructor (scope: Construct, id: string, props: GithubOidcConstructProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const repoSlug = `${props.githubOrg}/${props.githubRepo}`;

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
    // role that can actually deploy. This one can only assume the same
    // bootstrap roles for a read-only `cdk diff`.
    this.diffRole = new iam.Role(this, 'GitHubActionsDiffRole', {
      roleName: 'GitHubActionsDiffRole',
      assumedBy: new iam.OpenIdConnectPrincipal(provider, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: { 'token.actions.githubusercontent.com:sub': `repo:${repoSlug}:pull_request` }
      }),
      description: 'Assumed by GitHub Actions on pull requests to run cdk diff (read-only)'
    });
    this.diffRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: cdkBootstrapRoleArns
    }));
  }
}
