import { httpHandler, json } from '../../lib/http.js';

export const handler = httpHandler('health', async (event) =>
  json(200, {
    status: 'ok',
    color: event.stageVariables?.color ?? 'unknown',
    lambdaVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION ?? 'unknown',
    appVersion: process.env.APP_VERSION ?? 'dev',
    time: new Date().toISOString(),
    region: process.env.AWS_REGION ?? 'unknown',
  }),
);
