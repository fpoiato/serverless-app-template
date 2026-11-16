import { createHash } from 'node:crypto';
import type { CentralError } from '../central-error.js';

/**
 * Normaliza texto volátil para que a mesma falha gere sempre a mesma assinatura:
 * ids, números, hashes de bundle, linha:coluna, query strings.
 */
export function normalizeVolatile(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hash>')
    .replace(/([.-])[0-9a-z]{8,}(\.(?:m?js|css))/gi, '$1<hash>$2')
    .replace(/:\d+:\d+/g, ':<l>:<c>')
    .replace(/\?[^\s)'"]*/g, '?<q>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Primeiros frames do stack, sem caminhos absolutos voláteis. */
export function topFrames(stack: string | undefined, max = 3): string[] {
  if (!stack) return [];
  return stack
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at ') || /@https?:/.test(l))
    .slice(0, max)
    .map((l) => normalizeVolatile(l.replace(/\(?\/(?:var\/task|opt)\/[^\s)]*/g, '<path>')));
}

export function fingerprint(e: CentralError): string {
  const frames = topFrames(e.stack);
  const parts = [
    e.source,
    e.kind,
    e.function,
    e.errorName ?? '',
    // Com stack, o local da falha identifica o erro; sem stack, a mensagem normalizada.
    frames.length ? frames.join('|') : normalizeVolatile(e.message).slice(0, 300),
  ];
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32);
}
