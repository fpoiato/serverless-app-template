import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { env, GITHUB_OIDC_SUB_PREFIXES, name, PROJECT } from '../lib/config.js';
import { GithubOidcStack } from '../lib/github-oidc-stack.js';

const template = Template.fromStack(new GithubOidcStack(new App(), 'test', { env }));

describe('GithubOidcStack', () => {
  it('não cria um novo OIDC provider', () => {
    template.resourceCountIs('Custom::AWSCDKOpenIdConnectProvider', 0);
    template.resourceCountIs('AWS::IAM::OIDCProvider', 0);
  });

  it('role de deploy só confia nos environments protegidos do repo', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: name('gha-deploy'),
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: {
              StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
              StringLike: {
                'token.actions.githubusercontent.com:sub': [
                  ...GITHUB_OIDC_SUB_PREFIXES.flatMap((p) => [
                    `${p}:environment:prod-deploy`,
                    `${p}:environment:prod-swap`,
                  ]),
                ],
              },
            },
          }),
        ]),
      },
    });
  });

  it('role de leitura só confia em pull_request do repo', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: name('gha-readonly'),
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: {
              StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
              StringLike: {
                'token.actions.githubusercontent.com:sub': [
                  ...GITHUB_OIDC_SUB_PREFIXES.map((p) => `${p}:pull_request`),
                ],
              },
            },
          }),
        ]),
      },
    });
  });

  it('nenhuma policy concede acesso administrativo amplo', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    for (const p of Object.values(policies)) {
      const statements = (p as { Properties: { PolicyDocument: { Statement: unknown[] } } })
        .Properties.PolicyDocument.Statement as { Action: string | string[] }[];
      for (const s of statements) {
        const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
        expect(actions).not.toContain('*');
      }
    }
  });
});

describe('permissões de deploy e swap', () => {
  const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));

  it('Lambda só nas funções do projeto', () => {
    expect(policies).toContain('lambda:PublishVersion');
    expect(policies).toContain(`function:${name('*')}`);
  });

  it('DNS só na zona e só para nomes sob o domínio do projeto', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'SwapDns',
            Resource: `arn:aws:route53:::hostedzone/${PROJECT.hostedZoneId}`,
            Condition: {
              'ForAllValues:StringLike': {
                'route53:ChangeResourceRecordSetsNormalizedRecordNames': [
                  PROJECT.domain,
                  `*.${PROJECT.domain}`,
                  `_${PROJECT.domain}`,
                ],
              },
            },
          }),
        ]),
      },
    });
  });

  it('não cita distribuições CloudFront (a stack do frontend concede essas permissões)', () => {
    expect(policies).not.toContain('cloudfront:');
  });
});
