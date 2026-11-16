import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as destinations from 'aws-cdk-lib/aws-logs-destinations';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { PROJECT, name, ns } from '../config.js';
import { AppFunction } from './app-function.js';

export const CENTRAL_ERRORS_LOG_GROUP = ns('errors');
export const GITHUB_TOKEN_SECRET = `${PROJECT.slug}/github-issues-token`;

export interface ErrorPipelineProps {
  /** Tabela onde ficam fingerprints e o limite de issues por hora. */
  table: dynamodb.ITable;
}

/**
 * Filtro grosso aplicado em cada Lambda: qualquer linha que *possa* ser erro. O forwarder
 * decide com precisão (JSON `level=ERROR` ou falha de plataforma) e descarta o resto.
 */
export const ERROR_CANDIDATE_PATTERN = logs.FilterPattern.anyTerm(
  'ERROR',
  'Task timed out',
  'Runtime exited',
  'Runtime.OutOfMemory',
);

/**
 * Log group central `/<slug>/errors` (somente erros) + Lambda `<slug>-error-forwarder`.
 * Deve ser criado depois de todas as Lambdas da stack: assina o log group de cada
 * `AppFunction` da mesma stack com `forwardErrors !== false`.
 */
export class ErrorPipeline extends Construct {
  readonly logGroup: logs.LogGroup;
  readonly forwarder: AppFunction;
  readonly subscribed: AppFunction[];
  readonly errorToIssue: AppFunction;

  constructor(scope: Construct, id: string, props: ErrorPipelineProps) {
    super(scope, id);
    const stack = Stack.of(this);

    this.logGroup = new logs.LogGroup(this, 'Central', {
      logGroupName: CENTRAL_ERRORS_LOG_GROUP,
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.forwarder = new AppFunction(this, 'Forwarder', {
      name: 'error-forwarder',
      forwardErrors: false,
      timeout: Duration.seconds(30),
      environment: { CENTRAL_ERRORS_LOG_GROUP },
    });
    this.logGroup.grantWrite(this.forwarder.fn); // CreateLogStream + PutLogEvents

    this.subscribed = AppFunction.all(this).filter((f) => f.forwardErrors && Stack.of(f) === stack);
    for (const f of this.subscribed) {
      new logs.SubscriptionFilter(this, `Sub-${f.functionName}`, {
        logGroup: f.logGroup,
        destination: new destinations.LambdaDestination(this.forwarder.fn),
        filterPattern: ERROR_CANDIDATE_PATTERN,
        filterName: name('errors'),
      });
    }

    // ---------- /<slug>/errors → issue no GitHub (Triage) ----------
    this.errorToIssue = new AppFunction(this, 'ErrorToIssue', {
      name: 'error-to-issue',
      forwardErrors: false, // seus erros não podem gerar issues (loop)
      timeout: Duration.seconds(60),
      environment: {
        TABLE_NAME: props.table.tableName,
        GITHUB_REPO: PROJECT.repo,
        GITHUB_TOKEN_SECRET,
        MAX_ISSUES_PER_HOUR: '10',
        COMMENT_INTERVAL_MINUTES: '60',
      },
    });
    props.table.grantReadWriteData(this.errorToIssue.fn);
    secretsmanager.Secret.fromSecretNameV2(this, 'GithubToken', GITHUB_TOKEN_SECRET).grantRead(
      this.errorToIssue.fn,
    );
    new logs.SubscriptionFilter(this, 'CentralToIssue', {
      logGroup: this.logGroup,
      destination: new destinations.LambdaDestination(this.errorToIssue.fn),
      filterPattern: logs.FilterPattern.allEvents(),
      filterName: name('error-to-issue'),
    });
    const issueFailures = new logs.MetricFilter(this, 'ErrorToIssueFailures', {
      logGroup: this.errorToIssue.logGroup,
      filterPattern: logs.FilterPattern.stringValue('$.level', '=', 'ERROR'),
      metricNamespace: PROJECT.slug,
      metricName: 'ErrorToIssueFailures',
      metricValue: '1',
      defaultValue: 0,
    });
    new cloudwatch.Alarm(this, 'ErrorToIssueFailing', {
      alarmName: name('error-to-issue-failing'),
      alarmDescription: 'Erros não estão virando issues no GitHub (token ou GitHub fora)',
      metric: issueFailures.metric({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Volume de erros no log central e falhas do próprio forwarder.
    const errorCount = new logs.MetricFilter(this, 'ErrorCount', {
      logGroup: this.logGroup,
      filterPattern: logs.FilterPattern.allEvents(),
      metricNamespace: PROJECT.slug,
      metricName: 'CentralErrors',
      metricValue: '1',
      defaultValue: 0,
    });
    new cloudwatch.Alarm(this, 'ErrorsHigh', {
      alarmName: name('central-errors-high'),
      alarmDescription: `Muitos erros no ${ns('errors')} em 5 minutos`,
      metric: errorCount.metric({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: 20,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(this, 'ForwarderFailing', {
      alarmName: name('error-forwarder-failing'),
      alarmDescription: `O forwarder de erros está falhando: erros podem não chegar ao ${ns('errors')}`,
      metric: this.forwarder.fn.metricErrors({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}
