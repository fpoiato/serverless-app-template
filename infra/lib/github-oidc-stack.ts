import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { DEPLOY_ROLE_NAME, GITHUB_OIDC_SUB_PREFIXES, PROJECT, name } from './config.js';

/**
 * Roles assumidas pelo GitHub Actions via OIDC (sem access keys).
 * O OIDC provider do GitHub já existe na conta e é apenas referenciado.
 */
export class GithubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GithubProvider',
      PROJECT.githubOidcProviderArn,
    );

    const audience = { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' };
    const cdkRole = (kind: string) =>
      `arn:aws:iam::${PROJECT.account}:role/cdk-${PROJECT.cdkQualifier}-${kind}-role-${PROJECT.account}-${PROJECT.region}`;

    // Deploy e swap: somente a partir dos environments protegidos do repo.
    const deployRole = new iam.Role(this, 'DeployRole', {
      roleName: DEPLOY_ROLE_NAME,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: audience,
        StringLike: {
          'token.actions.githubusercontent.com:sub': GITHUB_OIDC_SUB_PREFIXES.flatMap((p) => [
            `${p}:environment:prod-deploy`,
            `${p}:environment:prod-swap`,
          ]),
        },
      }),
      description: `GitHub Actions (${PROJECT.repo}) - deploy e swap blue/green`,
    });

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkRoles',
        actions: ['sts:AssumeRole'],
        resources: ['deploy', 'file-publishing', 'image-publishing', 'lookup'].map(cdkRole),
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'FrontendSync',
        actions: ['s3:ListBucket', 's3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        resources: [`arn:aws:s3:::${name('web-*')}`, `arn:aws:s3:::${name('web-*')}/*`],
      }),
    );
    // Permissões sobre as distribuições CloudFront (invalidação e swap) são concedidas pela stack do
    // frontend, que cria as distribuições: nenhum ID gerado pela AWS precisa ser copiado para cá.
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ActiveColorParameter',
        // GetParametersByPath: /<slug>/public → /config.json do frontend.
        actions: ['ssm:GetParameter', 'ssm:GetParametersByPath', 'ssm:PutParameter'],
        resources: [`arn:aws:ssm:${PROJECT.region}:${PROJECT.account}:parameter/${PROJECT.slug}/*`],
      }),
    );

    // Deploy na cor inativa e swap (infra/scripts/deploy.sh e swap.sh).
    const arn = (svc: string, res: string) =>
      `arn:aws:${svc}:${PROJECT.region}:${PROJECT.account}:${res}`;
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'LambdaVersionsAndAliases',
        actions: ['lambda:GetAlias', 'lambda:PublishVersion', 'lambda:UpdateAlias'],
        resources: [
          arn('lambda', `function:${name('*')}`),
          arn('lambda', `function:${name('*')}:*`),
        ],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ListFunctionsAndStacks',
        actions: ['lambda:ListFunctions', 'cloudformation:DescribeStacks'],
        resources: ['*'],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ApiGatewayDeploymentsAndMappings',
        actions: ['apigateway:GET', 'apigateway:POST', 'apigateway:PATCH'],
        resources: [
          `arn:aws:apigateway:${PROJECT.region}::/restapis/*`,
          `arn:aws:apigateway:${PROJECT.region}::/apis/*`,
          `arn:aws:apigateway:${PROJECT.region}::/domainnames/*`,
        ],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SwapDns',
        actions: ['route53:ChangeResourceRecordSets'],
        resources: [`arn:aws:route53:::hostedzone/${PROJECT.hostedZoneId}`],
        conditions: {
          'ForAllValues:StringLike': {
            'route53:ChangeResourceRecordSetsNormalizedRecordNames': [
              PROJECT.domain,
              `*.${PROJECT.domain}`,
              `_${PROJECT.domain}`, // TXT de prova de posse exigido pelo associate-alias
            ],
          },
        },
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SwapDnsWait',
        actions: ['route53:GetChange'],
        resources: ['arn:aws:route53:::change/*'],
      }),
    );

    // Leitura para PRs (cdk diff): não pode alterar nada.
    const readOnlyRole = new iam.Role(this, 'ReadOnlyRole', {
      roleName: name('gha-readonly'),
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: audience,
        StringLike: {
          'token.actions.githubusercontent.com:sub': GITHUB_OIDC_SUB_PREFIXES.map(
            (p) => `${p}:pull_request`,
          ),
        },
      }),
      description: `GitHub Actions (${PROJECT.repo}) - leitura para cdk diff em PRs`,
    });
    readOnlyRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkLookup',
        actions: ['sts:AssumeRole'],
        resources: [cdkRole('lookup')],
      }),
    );
    readOnlyRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadStacks',
        actions: [
          'cloudformation:DescribeStacks',
          'cloudformation:GetTemplate',
          'cloudformation:ListStacks',
          'ssm:GetParameter',
        ],
        resources: ['*'],
      }),
    );

    new CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
    new CfnOutput(this, 'ReadOnlyRoleArn', { value: readOnlyRole.roleArn });
  }
}
