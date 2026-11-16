import { App, Tags } from 'aws-cdk-lib';
import { BackendStack } from '../lib/backend-stack.js';
import { PROJECT, env, name } from '../lib/config.js';
import { DnsCertsStack } from '../lib/dns-certs-stack.js';
import { FrontendStack } from '../lib/frontend-stack.js';
import { GithubOidcStack } from '../lib/github-oidc-stack.js';
import { isColor } from '../lib/constructs/app-function.js';

const app = new App();
Tags.of(app).add('project', PROJECT.slug);

// Cor ativa: o deploy passa `-c app:activeColor=$(aws ssm get-parameter --name /<slug>/active-color ...)`.
const activeColor = app.node.tryGetContext('app:activeColor') ?? 'blue';
if (!isColor(activeColor)) throw new Error(`app:activeColor inválido: ${activeColor}`);

new GithubOidcStack(app, name('github-oidc'), { env });
const dns = new DnsCertsStack(app, name('dns-certs'), { env });
new BackendStack(app, name('backend'), {
  env,
  zone: dns.zone,
  certificate: dns.certificate,
  activeColor,
});

new FrontendStack(app, name('frontend'), {
  env,
  zone: dns.zone,
  certificate: dns.certificate,
  activeColor,
});

app.synth();
