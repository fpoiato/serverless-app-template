import { describe, expect, it, vi } from 'vitest';
import { loadRuntimeConfig, localConfig, resolveConfig } from './app-config';

describe('localConfig', () => {
  it('aponta para os domínios principais', () => {
    expect(localConfig('exemplo.com')).toEqual({
      color: 'local',
      appVersion: 'dev',
      apiUrl: 'https://api.exemplo.com',
      wsUrl: 'wss://ws.exemplo.com',
      public: {},
    });
  });
});

describe('resolveConfig', () => {
  it('usa os valores do /config.json da cor', () => {
    const c = resolveConfig(
      {
        color: 'green',
        version: 'abc123',
        apiUrl: 'https://api-green.exemplo.com',
        wsUrl: 'wss://ws-green.exemplo.com',
        public: { 'auth/client-id': 'xyz', ruim: 42 },
      },
      'exemplo.com',
    );
    expect(c).toEqual({
      color: 'green',
      appVersion: 'abc123',
      apiUrl: 'https://api-green.exemplo.com',
      wsUrl: 'wss://ws-green.exemplo.com',
      public: { 'auth/client-id': 'xyz' },
    });
  });

  it('valores inválidos caem no padrão local', () => {
    expect(resolveConfig({ color: 'red', apiUrl: 3 }, 'exemplo.com')).toEqual(
      localConfig('exemplo.com'),
    );
    expect(resolveConfig(null, 'exemplo.com')).toEqual(localConfig('exemplo.com'));
  });
});

describe('loadRuntimeConfig', () => {
  const response = (body: string, type: string, status = 200) =>
    new Response(body, { status, headers: { 'content-type': type } });

  it('carrega /config.json sem cache', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        response(JSON.stringify({ color: 'blue', version: 'v1' }), 'application/json'),
      );
    const c = await loadRuntimeConfig(fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('/config.json', { cache: 'no-store' });
    expect(c.color).toBe('blue');
    expect(c.appVersion).toBe('v1');
  });

  it('index.html do fallback de SPA, 404 ou erro de rede → padrão local', async () => {
    for (const f of [
      vi.fn().mockResolvedValue(response('<!doctype html>', 'text/html')),
      vi.fn().mockResolvedValue(response('', 'application/json', 404)),
      vi.fn().mockRejectedValue(new Error('offline')),
    ]) {
      expect((await loadRuntimeConfig(f)).color).toBe('local');
    }
  });
});
