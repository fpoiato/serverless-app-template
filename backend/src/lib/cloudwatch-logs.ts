import { gunzipSync } from 'node:zlib';
import type { CloudWatchLogsDecodedData, CloudWatchLogsEvent } from 'aws-lambda';

export function decodeLogsEvent(event: CloudWatchLogsEvent): CloudWatchLogsDecodedData {
  return JSON.parse(gunzipSync(Buffer.from(event.awslogs.data, 'base64')).toString('utf8'));
}
