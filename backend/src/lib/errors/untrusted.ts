/**
 * Texto vindo de logs, stacks ou do frontend é dado NÃO confiável: pode conter instruções
 * maliciosas, menções e markdown. Antes de ir ao GitHub ou ao modelo:
 * - neutraliza @menções (não notifica ninguém)
 * - neutraliza cercas de código (não fecha o bloco de evidência)
 * - neutraliza palavras-chave de fechamento de issue
 * - limita o tamanho
 */
export function neutralize(text: string, max = 4_000): string {
  const out = text
    .replace(/@(?=[A-Za-z0-9-])/g, '@​')
    .replace(/`{3,}/g, "'''")
    .replace(/~{3,}/g, '---')
    .replace(/\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)(\s+#\d+)/gi, '$1​$2');
  return out.length > max ? `${out.slice(0, max)}…[truncado]` : out;
}
