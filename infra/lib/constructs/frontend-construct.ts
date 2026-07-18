import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'node:path';

export class FrontendConstruct extends Construct {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor (scope: Construct, id: string) {
    super(scope, id);

    // Disposable PoC stack: DESTROY + autoDeleteObjects is correct here —
    // would be the wrong call for a real production bucket.
    this.bucket = new s3.Bucket(this, 'Bucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      },
      defaultRootObject: 'index.html',
      // SPA deep-link/refresh support: an unknown path returns 403 (no
      // public ListBucket) or 404 from S3 — both get rewritten to the
      // app shell so client-side routing takes over, instead of a raw
      // S3 XML error page.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' }
      ]
      // No ACM/custom domain — default *.cloudfront.net cert only, per
      // the deployment plan's deliberate scope cut for this PoC.
    });

    new s3deploy.BucketDeployment(this, 'Deployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', '..', '..', 'frontend', 'dist'))],
      destinationBucket: this.bucket,
      // Verified CDK behavior (not the infra doc's manual
      // `aws cloudfront create-invalidation` suggestion): passing the
      // distribution here makes BucketDeployment invalidate it as part
      // of the same deploy.
      distribution: this.distribution,
      distributionPaths: ['/*']
    });
  }
}
