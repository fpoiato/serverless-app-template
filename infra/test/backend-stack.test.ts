import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { describe, expect, it } from 'vitest';
import { BackendStack } from '../lib/backend-stack.js';
import { env, name, PROJECT } from '../lib/config.js';
import { AppFunction } from '../lib/constructs/app-function.js';

function synth(activeColor: 'blue' | 'green') {
  const app = new App();
  const deps = new Stack(app, 'deps', { env });
  const zone = route53.HostedZone.fromHostedZoneAttributes(deps, 'Z', {
    hostedZoneId: 'Z1',
    zoneName: PROJECT.hostedZoneName,
  });
  const certificate = acm.Certificate.fromCertificateArn(
    deps,
    'C',
    `arn:aws:acm:${PROJECT.region}:${PROJECT.account}:certificate/x`,
  );
  const stack = new BackendStack(app, 'backend', { env, zone, certificate, activeColor });
  return { app, stack, t: Template.fromStack(stack) };
}

const { app, stack, t } = synth('blue');

describe('BackendStack', () => {
  it('tabela principal com PITR, TTL, proteção contra exclusão e retenção', () => {
    t.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        TableName: name('main'),
        DeletionProtectionEnabled: true,
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      }),
    });
  });

  it('toda Lambda tem log group próprio e aliases blue/green', () => {
    const fns = AppFunction.all(app);
    expect(fns.map((f) => f.functionName).sort()).toEqual([
      name('client-errors'),
      name('error-forwarder'),
      name('error-to-issue'),
      name('health'),
      name('ws-connection'),
    ]);
    for (const f of fns) {
      t.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: `/aws/lambda/${f.functionName}`,
      });
    }
    t.resourcePropertiesCountIs(
      'AWS::Lambda::Alias',
      { Name: 'blue', FunctionVersion: '$LATEST' },
      5,
    );
    t.resourcePropertiesCountIs(
      'AWS::Lambda::Alias',
      { Name: 'green', FunctionVersion: '$LATEST' },
      5,
    );
  });

  it('Lambdas em Node 22 ARM64 com X-Ray', () => {
    t.allResourcesProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      TracingConfig: { Mode: 'Active' },
    });
  });

  it('stages REST e WebSocket blue/green com a stage variable color', () => {
    for (const color of ['blue', 'green']) {
      t.hasResourceProperties('AWS::ApiGateway::Stage', { StageName: color, Variables: { color } });
      t.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
        StageName: color,
        StageVariables: { color },
      });
    }
  });

  it('integração REST usa o alias da cor da stage', () => {
    t.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'GET',
      Integration: Match.objectLike({
        Type: 'AWS_PROXY',
        Uri: Match.objectLike({
          'Fn::Join': Match.arrayWith([Match.arrayWith([':${stageVariables.color}/invocations'])]),
        }),
      }),
    });
  });

  it('API Gateway pode invocar os dois aliases', () => {
    const perms = t.findResources('AWS::Lambda::Permission');
    const qualified = Object.values(perms)
      .map((p) =>
        JSON.stringify((p as { Properties: { FunctionName: unknown } }).Properties.FunctionName),
      )
      .filter((s) => s.includes(':blue') || s.includes(':green'));
    expect(qualified.length).toBeGreaterThanOrEqual(4);
  });

  it('domínio ativo segue a cor ativa e os de cor ficam fixos', () => {
    // ID lógico do domínio contém o host sem pontos; Stage é o nome literal da stage.
    const stageOf = (tpl: Template, host: string) => {
      const key = `RestDomain${host.replace(/[^A-Za-z0-9]/g, '')}`;
      const m = Object.values(tpl.findResources('AWS::ApiGateway::BasePathMapping')).find((r) =>
        JSON.stringify(r).includes(key),
      ) as { Properties: { Stage: string } } | undefined;
      return m?.Properties.Stage;
    };
    expect(stageOf(t, `api.${PROJECT.domain}`)).toBe('blue');
    const green = synth('green').t;
    expect(stageOf(green, `api.${PROJECT.domain}`)).toBe('green');
    expect(stageOf(green, `api-blue.${PROJECT.domain}`)).toBe('blue');
    expect(stageOf(green, `api-green.${PROJECT.domain}`)).toBe('green');
  });

  it('cria registros só sob o domínio do projeto', () => {
    const names = Object.values(t.findResources('AWS::Route53::RecordSet')).map(
      (r) => (r as { Properties: { Name: string } }).Properties.Name,
    );
    expect(names.length).toBe(6);
    for (const n of names)
      expect(n).toMatch(new RegExp(`${PROJECT.domain.replace(/\./g, '\\.')}\\.?$`));
  });

  it('stack tem nome estável', () => {
    expect(stack.stackName).toBe('backend');
  });
});

describe('POST /client-errors', () => {
  it('rota pública com throttling próprio nas duas stages', () => {
    t.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'POST',
      AuthorizationType: 'NONE',
    });
    for (const color of ['blue', 'green']) {
      t.hasResourceProperties('AWS::ApiGateway::Stage', {
        StageName: color,
        MethodSettings: Match.arrayWith([
          Match.objectLike({
            HttpMethod: 'POST',
            ResourcePath: '/~1client-errors',
            ThrottlingRateLimit: 20,
          }),
        ]),
      });
    }
  });

  it('WAF com limite por IP associado às duas stages', () => {
    t.hasResourceProperties('AWS::WAFv2::WebACL', {
      Scope: 'REGIONAL',
      Rules: [
        Match.objectLike({
          Name: 'client-errors-rate-per-ip',
          Action: { Block: {} },
          Statement: {
            RateBasedStatement: Match.objectLike({ Limit: 100, AggregateKeyType: 'IP' }),
          },
        }),
      ],
    });
    t.resourceCountIs('AWS::WAFv2::WebACLAssociation', 2);
  });

  it('todas as Lambdas recebem a lista de origens permitidas', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: name('client-errors'),
      Environment: {
        Variables: Match.objectLike({
          ALLOWED_ORIGINS: Match.stringLikeRegexp(`https://${PROJECT.domain}`),
        }),
      },
    });
  });
});
