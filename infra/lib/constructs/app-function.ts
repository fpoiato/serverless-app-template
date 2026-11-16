import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { PROJECT, name } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_FUNCTIONS_DIR = path.resolve(here, '../../../backend/src/functions');

export const COLORS = ['blue', 'green'] as const;
export type Color = (typeof COLORS)[number];

export interface AppFunctionProps {
  /** Nome curto; a função se chama `<slug>-<name>` e o código fica em backend/src/functions/<name>/handler.ts */
  name: string;
  environment?: Record<string, string>;
  timeout?: Duration;
  memorySize?: number;
  /** Sobrescreve o entry (testes). */
  entry?: string;
  /**
   * Se os logs desta função devem alimentar o `/<slug>/errors` (padrão: true).
   * Só o próprio forwarder do pipeline de erros usa `false`, para não haver recursão.
   */
  forwardErrors?: boolean;
}

/**
 * Toda Lambda do projeto nasce deste construct, que garante:
 * - Node 22, ARM64, bundling esbuild, X-Ray
 * - log group próprio `/aws/lambda/<slug>-<name>` com retenção definida
 * - aliases `blue` e `green` (CloudFormation só os cria; quem aponta versões é o deploy, #15)
 * - registro em `AppFunction.all(scope)`; o `ErrorPipeline` assina os logs de erro de todas
 */
export class AppFunction extends Construct {
  readonly fn: nodejs.NodejsFunction;
  readonly logGroup: logs.LogGroup;
  readonly aliases: Record<Color, lambda.CfnAlias>;
  readonly functionName: string;
  readonly forwardErrors: boolean;

  private static readonly registry = new WeakMap<Construct, AppFunction[]>();

  /** Todas as AppFunction criadas sob o App da raiz informada. */
  static all(scope: Construct): AppFunction[] {
    return AppFunction.registry.get(scope.node.root) ?? [];
  }

  constructor(scope: Construct, id: string, props: AppFunctionProps) {
    super(scope, id);
    this.functionName = name(props.name);
    this.forwardErrors = props.forwardErrors ?? true;

    this.logGroup = new logs.LogGroup(this, 'Logs', {
      logGroupName: `/aws/lambda/${this.functionName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.fn = new nodejs.NodejsFunction(this, 'Fn', {
      functionName: this.functionName,
      entry: props.entry ?? path.join(BACKEND_FUNCTIONS_DIR, props.name, 'handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: props.memorySize ?? 256,
      timeout: props.timeout ?? Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE,
      logGroup: this.logGroup,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        APP_VERSION: scope.node.tryGetContext('app:appVersion') ?? 'dev',
        APP_SLUG: PROJECT.slug,
        ...props.environment,
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: 'node22',
        sourceMap: true,
        minify: true,
        mainFields: ['module', 'main'],
        banner:
          "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
      },
    });

    // Aliases apontam para $LATEST na criação; o deploy (#15) publica versões e
    // move só o alias da cor inativa. Como o valor no template nunca muda,
    // o CloudFormation não desfaz o que o deploy fez.
    this.aliases = {
      blue: this.alias('blue'),
      green: this.alias('green'),
    };

    const list = AppFunction.registry.get(this.node.root) ?? [];
    list.push(this);
    AppFunction.registry.set(this.node.root, list);
  }

  private alias(color: Color): lambda.CfnAlias {
    return new lambda.CfnAlias(this, `Alias-${color}`, {
      functionName: this.fn.functionName,
      functionVersion: '$LATEST',
      name: color,
    });
  }

  /** ARN da função qualificado pela stage variable `color` do API Gateway. */
  get stageQualifiedArn(): string {
    return `${this.fn.functionArn}:\${stageVariables.color}`;
  }
}

export function isColor(value: unknown): value is Color {
  return value === 'blue' || value === 'green';
}
