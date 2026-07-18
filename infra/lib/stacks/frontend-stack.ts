import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { FrontendConstruct } from '../constructs/frontend-construct';
import { CDK_SSM_PARAMS } from '../cdk-ssm-params';

// No dependency on AuthStack/ApiStack: S3+CloudFront don't need to know
// anything about Cognito or the API at CDK-declare time (the frontend
// build itself picks those up separately via scripts/write-frontend-env.mjs
// after all three stacks exist). AuthStack is the one that depends on
// this stack, for the CloudFront domain in its callback URLs.
export class FrontendStack extends cdk.Stack {
  constructor (scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const frontend = new FrontendConstruct(this, 'Frontend');

    new cdk.CfnOutput(this, 'CloudFrontDomain', { value: frontend.distribution.distributionDomainName });
    new cdk.CfnOutput(this, 'CloudFrontDistributionId', { value: frontend.distribution.distributionId });

    new ssm.StringParameter(this, 'CloudFrontDomainParam', {
      parameterName: CDK_SSM_PARAMS.frontendCloudFrontDomain,
      stringValue: frontend.distribution.distributionDomainName
    });
  }
}
