export type DeployColor = 'blue' | 'green';

export function isDeployColor(value: unknown): value is DeployColor {
  return value === 'blue' || value === 'green';
}

export * from './logger/index.js';
export * from './client-errors.js';
