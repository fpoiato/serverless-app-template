import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { env, ns, PROJECT } from '../lib/config.js';
import { DnsCertsStack } from '../lib/dns-certs-stack.js';

const template = Template.fromStack(new DnsCertsStack(new App(), 'test', { env }));

describe('DnsCertsStack', () => {
  it('não cria nem altera a hosted zone', () => {
    template.resourceCountIs('AWS::Route53::HostedZone', 0);
    template.resourceCountIs('AWS::Route53::RecordSet', 0);
  });

  it('certificado cobre o domínio e os subdomínios com validação DNS', () => {
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: PROJECT.domain,
      SubjectAlternativeNames: [`*.${PROJECT.domain}`],
      ValidationMethod: 'DNS',
      // O wildcard usa o mesmo registro de validação do domínio raiz.
      DomainValidationOptions: [{ DomainName: PROJECT.domain, HostedZoneId: PROJECT.hostedZoneId }],
    });
  });

  it('certificado é retido se a stack for removida', () => {
    template.hasResource('AWS::CertificateManager::Certificate', {
      DeletionPolicy: 'Retain',
    });
  });

  it('publica o ARN no SSM', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', { Name: ns('certificate-arn') });
  });
});
