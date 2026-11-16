import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

export const secrets = new SecretsManagerClient({});
let cachedToken: string | undefined;

async function token(): Promise<string> {
  if (!cachedToken) {
    const res = await secrets.send(
      new GetSecretValueCommand({ SecretId: process.env.GITHUB_TOKEN_SECRET! }),
    );
    cachedToken = res.SecretString!.trim();
  }
  return cachedToken;
}

/** Só para testes. */
export function resetTokenCache(): void {
  cachedToken = undefined;
}

async function gh<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await token()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': `${process.env.APP_SLUG ?? 'app'}-error-to-issue`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(
      `GitHub ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

export interface Issue {
  number: number;
  state: 'open' | 'closed';
  html_url: string;
}

export const github = {
  createIssue: (title: string, body: string, labels: string[]) =>
    gh<Issue>('POST', '/issues', { title, body, labels }),
  getIssue: (n: number) => gh<Issue>('GET', `/issues/${n}`),
  comment: (n: number, body: string) =>
    gh<{ id: number }>('POST', `/issues/${n}/comments`, { body }),
};
