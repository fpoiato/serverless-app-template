import { InjectionToken } from '@angular/core';
import { PROJECT } from './project';

/**
 * Configuração de runtime do frontend. Em produção vem de `/config.json`, gerado no deploy para cada cor
 * a partir do SSM (`infra/scripts/web-config.mjs`): um mesmo build serve às duas cores. Sem o arquivo
 * (ng serve, testes), usa o padrão local apontando para os domínios principais.
 */
export type AppColor = 'blue' | 'green' | 'local';

export interface AppConfig {
  color: AppColor;
  appVersion: string;
  apiUrl: string;
  wsUrl: string;
  /** Parâmetros SSM em `/<slug>/public/...` (ex.: `auth/user-pool-id`). */
  public: Readonly<Record<string, string>>;
}

export function localConfig(domain: string = PROJECT.domain): AppConfig {
  return {
    color: 'local',
    appVersion: 'dev',
    apiUrl: `https://api.${domain}`,
    wsUrl: `wss://ws.${domain}`,
    public: {},
  };
}

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Valida o JSON de `/config.json`; qualquer coisa inválida cai no padrão local. */
export function resolveConfig(raw: unknown, domain: string = PROJECT.domain): AppConfig {
  const fallback = localConfig(domain);
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Record<string, unknown>;
  const color = r['color'] === 'blue' || r['color'] === 'green' ? r['color'] : fallback.color;
  const pub =
    r['public'] && typeof r['public'] === 'object'
      ? Object.fromEntries(
          Object.entries(r['public'] as Record<string, unknown>).filter(([, v]) => isString(v)),
        )
      : {};
  return {
    color,
    appVersion: isString(r['version']) ? r['version'] : fallback.appVersion,
    apiUrl: isString(r['apiUrl']) ? r['apiUrl'] : fallback.apiUrl,
    wsUrl: isString(r['wsUrl']) ? r['wsUrl'] : fallback.wsUrl,
    public: pub as Record<string, string>,
  };
}

/** Busca `/config.json` antes de iniciar o app. Nunca lança. */
export async function loadRuntimeConfig(fetchFn: typeof fetch = fetch): Promise<AppConfig> {
  try {
    const res = await fetchFn('/config.json', { cache: 'no-store' });
    const type = res.headers.get('content-type') ?? '';
    // O fallback de SPA do CloudFront devolve index.html (200) para arquivos inexistentes.
    if (!res.ok || !type.includes('json')) return localConfig();
    return resolveConfig(await res.json());
  } catch {
    return localConfig();
  }
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG', {
  providedIn: 'root',
  factory: () => localConfig(),
});
