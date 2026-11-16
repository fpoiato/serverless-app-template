import { describe, expect, it } from 'vitest';
import { isDeployColor } from './index.js';

describe('isDeployColor', () => {
  it('aceita blue e green', () => {
    expect(isDeployColor('blue')).toBe(true);
    expect(isDeployColor('green')).toBe(true);
  });

  it('rejeita outros valores', () => {
    expect(isDeployColor('red')).toBe(false);
    expect(isDeployColor(undefined)).toBe(false);
  });
});
