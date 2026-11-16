import { InjectionToken } from '@angular/core';
import { PROJECT } from './project';

/**
 * Valores injetados no build com `ng build --define`:
 * - APP_COLOR: cor do bucket que receberá o build (`blue`/`green`); `local` no dev server
 * - APP_VERSION: versão/commit do app
 * O frontend de uma cor sempre fala com a API da mesma cor (blue/green consistente).
 */
declare const APP_COLOR: string | undefined;
declare const APP_VERSION: string | undefined;

export type AppColor = 'blue' | 'green' | 'local';

export interface AppConfig {
  color: AppColor;
  appVersion: string;
  apiUrl: string;
  wsUrl: string;
}

export function buildConfig(
  color?: string,
  appVersion?: string,
  domain: string = PROJECT.domain,
): AppConfig {
  const c: AppColor = color === 'blue' || color === 'green' ? color : 'local';
  const suffix = c === 'local' ? '' : `-${c}`;
  return {
    color: c,
    appVersion: appVersion || 'dev',
    apiUrl: `https://api${suffix}.${domain}`,
    wsUrl: `wss://ws${suffix}.${domain}`,
  };
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG', {
  providedIn: 'root',
  factory: () =>
    buildConfig(
      typeof APP_COLOR === 'undefined' ? undefined : APP_COLOR,
      typeof APP_VERSION === 'undefined' ? undefined : APP_VERSION,
    ),
});
