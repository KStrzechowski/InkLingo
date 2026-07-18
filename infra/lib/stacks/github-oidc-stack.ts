import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { GithubOidcConstruct } from '../constructs/github-oidc-construct';

// No dependency on the other stacks — this just grants GitHub Actions
// permission to assume the CDK-bootstrap-created roles, which already
// exist independently of anything this app deploys.
export class GithubOidcStack extends cdk.Stack {
  constructor (scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const oidc = new GithubOidcConstruct(this, 'GithubOidc', {
      githubOrg: 'KStrzechowski',
      githubRepo: 'InkLingo'
    });

    new cdk.CfnOutput(this, 'GitHubActionsDeployRoleArn', { value: oidc.deployRole.roleArn });
    new cdk.CfnOutput(this, 'GitHubActionsDiffRoleArn', { value: oidc.diffRole.roleArn });
  }
}
