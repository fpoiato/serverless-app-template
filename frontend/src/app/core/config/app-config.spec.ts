import { describe, expect, it } from 'vitest';
import { buildConfig } from './app-config';

describe('buildConfig', () => {
  it('cada cor fala com a API da mesma cor', () => {
    expect(buildConfig('blue', '1', 'exemplo.com').apiUrl).toBe('https://api-blue.exemplo.com');
    expect(buildConfig('green', '1', 'exemplo.com').wsUrl).toBe('wss://ws-green.exemplo.com');
  });

  it('local usa os domínios principais', () => {
    expect(buildConfig(undefined, undefined, 'exemplo.com')).toEqual({
      color: 'local',
      appVersion: 'dev',
      apiUrl: 'https://api.exemplo.com',
      wsUrl: 'wss://ws.exemplo.com',
    });
  });
});
