import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { describe, expect, it } from 'vitest';
import { BackendStack } from '../lib/backend-stack.js';
import { env, name, ns, PROJECT } from '../lib/config.js';

const app = new App();
const deps = new Stack(app, 'deps', { env });
const stack = new BackendStack(app, 'backend', {
  env,
  activeColor: 'blue',
  zone: route53.HostedZone.fromHostedZoneAttributes(deps, 'Z', {
    hostedZoneId: 'Z1',
    zoneName: PROJECT.hostedZoneName,
  }),
  certificate: acm.Certificate.fromCertificateArn(
    deps,
    'C',
    `arn:aws:acm:${PROJECT.region}:${PROJECT.account}:certificate/x`,
  ),
});
const t = Template.fromStack(stack);

type Sub = { Properties: { LogGroupName: unknown; DestinationArn: unknown } };
const subs = () => Object.values(t.findResources('AWS::Logs::SubscriptionFilter')) as Sub[];
/** Log groups assinados pelo forwarder (pipeline de erros das Lambdas). */
const subscribedGroups = () =>
  subs()
    .filter((r) => JSON.stringify(r.Properties.DestinationArn).includes('Forwarder'))
    .map((r) => JSON.stringify(r.Properties.LogGroupName));

describe('ErrorPipeline', () => {
  it('cria o log group central retido', () => {
    t.hasResource('AWS::Logs::LogGroup', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({ LogGroupName: ns('errors') }),
    });
  });

  it('assina todas as Lambdas do projeto, exceto o próprio forwarder', () => {
    const groups = subscribedGroups();
    expect(groups.length).toBe(3); // health, ws-connection e client-errors (não o forwarder nem o error-to-issue)
    expect(groups.some((s) => s.includes('Forwarder'))).toBe(false);
    for (const r of subs().filter((x) =>
      JSON.stringify(x.Properties.DestinationArn).includes('Forwarder'),
    )) {
      expect((r.Properties as unknown as { FilterPattern: string }).FilterPattern).toBe(
        '?"ERROR" ?"Task timed out" ?"Runtime exited" ?"Runtime.OutOfMemory"',
      );
    }
  });

  it('o forwarder não assina o log central (sem recursão)', () => {
    expect(subscribedGroups().some((s) => s.includes('Central'))).toBe(false);
  });

  it('forwarder escreve no log central', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: name('error-forwarder'),
      Environment: { Variables: Match.objectLike({ CENTRAL_ERRORS_LOG_GROUP: ns('errors') }) },
    });
  });

  it('error-to-issue assina o log central e não é assinado por ninguém', () => {
    const central = subs().filter((r) =>
      JSON.stringify(r.Properties.LogGroupName).includes('Central'),
    );
    expect(central).toHaveLength(1);
    expect(JSON.stringify(central[0]!.Properties.DestinationArn)).toContain('ErrorToIssue');
    expect(subscribedGroups().some((s) => s.includes('ErrorToIssue'))).toBe(false);
  });

  it('error-to-issue: secret do token e limites', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: name('error-to-issue'),
      Environment: {
        Variables: Match.objectLike({
          GITHUB_REPO: PROJECT.repo,
          GITHUB_TOKEN_SECRET: `${PROJECT.slug}/github-issues-token`,
          MAX_ISSUES_PER_HOUR: '10',
        }),
      },
    });
    const policies = JSON.stringify(t.findResources('AWS::IAM::Policy'));
    expect(policies).not.toContain('bedrock');
    expect(policies).toContain('secretsmanager:GetSecretValue');
  });

  it('alarmes de volume de erros e de falha do forwarder', () => {
    t.hasResourceProperties('AWS::CloudWatch::Alarm', { AlarmName: name('central-errors-high') });
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: name('error-forwarder-failing'),
    });
  });
});
