import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import type * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { DEPLOY_ROLE_NAME, HOSTS, PROJECT, name, ns } from './config.js';
import { COLORS, type Color } from './constructs/app-function.js';

export interface FrontendStackProps extends StackProps {
  zone: route53.IHostedZone;
  certificate: acm.ICertificate;
  /** Cor que atende o domínio principal. Vem de /<slug>/active-color via contexto. */
  activeColor: Color;
}

const COLOR_HOST: Record<Color, string> = { blue: HOSTS.webBlue, green: HOSTS.webGreen };

/** CSP do app. Ajustar aqui quando o frontend passar a falar com outros domínios. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://${HOSTS.media}`,
  "font-src 'self' data:",
  `connect-src 'self' https://${HOSTS.api} https://${HOSTS.apiBlue} https://${HOSTS.apiGreen} wss://${HOSTS.ws} wss://${HOSTS.wsBlue} wss://${HOSTS.wsGreen}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

/**
 * Frontend blue/green: um bucket e uma distribuição por cor.
 * - `blue.<domínio>` / `green.<domínio>` ficam sempre na sua distribuição
 * - o domínio principal fica na distribuição da cor ativa
 * O CloudFront não permite o mesmo domínio em duas distribuições; o swap move o domínio com
 * `cloudfront associate-alias` (atômico) e depois o CDK reconcilia o template (ver ADR 0002).
 */
export class FrontendStack extends Stack {
  readonly buckets = {} as Record<Color, s3.Bucket>;
  readonly distributions = {} as Record<Color, cloudfront.Distribution>;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const headers = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      responseHeadersPolicyName: name('web-security'),
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: CONTENT_SECURITY_POLICY, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          preload: false,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
    });

    for (const color of COLORS) {
      const bucket = new s3.Bucket(this, `Bucket-${color}`, {
        bucketName: name(`web-${color}`),
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        versioned: true,
        lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(30) }],
        removalPolicy: RemovalPolicy.RETAIN,
      });

      const isActive = color === props.activeColor;
      const distribution = new cloudfront.Distribution(this, `Distribution-${color}`, {
        comment: `${PROJECT.slug} web ${color}`,
        domainNames: isActive ? [HOSTS.web, COLOR_HOST[color]] : [COLOR_HOST[color]],
        certificate: props.certificate,
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        defaultRootObject: 'index.html',
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: headers,
          compress: true,
        },
        // SPA: rotas do Angular caem no index.html
        errorResponses: [403, 404].map((httpStatus) => ({
          httpStatus,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.seconds(0),
        })),
      });

      this.alias(props.zone, `Web-${color}`, COLOR_HOST[color], distribution);
      if (isActive) this.alias(props.zone, 'Web-active', HOSTS.web, distribution);

      new ssm.StringParameter(this, `BucketParam-${color}`, {
        parameterName: ns(`web/${color}/bucket`),
        stringValue: bucket.bucketName,
      });
      new ssm.StringParameter(this, `DistributionParam-${color}`, {
        parameterName: ns(`web/${color}/distribution-id`),
        stringValue: distribution.distributionId,
      });
      new CfnOutput(this, `DistributionId-${color}`, { value: distribution.distributionId });

      this.buckets[color] = bucket;
      this.distributions[color] = distribution;
    }
    // A stack que cria as distribuições concede à role de deploy o que ela precisa sobre elas
    // (invalidação no deploy; associate-alias exige também UpdateDistribution no swap).
    const deployRole = iam.Role.fromRoleName(this, 'DeployRole', DEPLOY_ROLE_NAME);
    new iam.Policy(this, 'DeployRoleDistributions', {
      policyName: name('deploy-distributions'),
      roles: [deployRole],
      statements: [
        new iam.PolicyStatement({
          sid: 'DeployAndSwapDistributions',
          actions: [
            'cloudfront:CreateInvalidation',
            'cloudfront:GetInvalidation',
            'cloudfront:GetDistribution',
            'cloudfront:AssociateAlias',
            'cloudfront:UpdateDistribution',
          ],
          resources: COLORS.map((c) => this.distributions[c].distributionArn),
        }),
      ],
    });
  }

  private alias(zone: route53.IHostedZone, id: string, host: string, d: cloudfront.Distribution) {
    const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(d));
    new route53.ARecord(this, `${id}-A`, { zone, recordName: host, target });
    new route53.AaaaRecord(this, `${id}-AAAA`, { zone, recordName: host, target });
  }
}
