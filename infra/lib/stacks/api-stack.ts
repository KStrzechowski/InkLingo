import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { ApiConstruct } from '../constructs/api-construct';

export interface ApiStackProps extends cdk.StackProps {
  allowedOrigin?: string;
}

// Fully self-contained: reads AuthStack's UserPool/Client back via SSM
// Parameter Store (see ApiConstruct) rather than taking them as props —
// AuthStack never needs to be constructed in the same synth run.
export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigatewayv2.HttpApi;

  constructor(scope: Construct, id: string, props?: ApiStackProps) {
    super(scope, id, props);

    const api = new ApiConstruct(this, 'Api', {
      allowedOrigin: props?.allowedOrigin
    });
    this.httpApi = api.httpApi;

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.httpApi.apiEndpoint });
  }
}
