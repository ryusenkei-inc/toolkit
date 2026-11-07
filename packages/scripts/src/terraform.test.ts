import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { backendConfigArgs, r2CredentialsOf, stackOf, stateKeyOf } from './terraform.ts';

describe('stackOf', () => {
  it('-chdir のディレクトリと、最初のサブコマンド', () => {
    expect(stackOf(['-chdir=infra/stacks/site', 'init', '-upgrade'])).toEqual({ dir: 'infra/stacks/site', subcommand: 'init', index: 1 });
    expect(stackOf(['plan'])).toEqual({ dir: undefined, subcommand: 'plan', index: 0 });
    expect(stackOf(['-version'])).toEqual({ dir: undefined, subcommand: undefined, index: -1 });
  });
});

describe('state', () => {
  it('キーは <接頭辞>/<スタックのディレクトリ名>.tfstate', () => {
    expect(stateKeyOf('example', 'infra/stacks/site', '/repo')).toBe('example/site.tfstate');
    expect(stateKeyOf('example', undefined, '/repo/infra')).toBe('example/infra.tfstate');
  });

  it('backend の設定は bucket・key・lock と、R2 のための AWS の検査の無効化', () => {
    const args = backendConfigArgs('company-tfstate', 'example/site.tfstate');
    expect(args).toContain('-backend-config=bucket=company-tfstate');
    expect(args).toContain('-backend-config=key=example/site.tfstate');
    expect(args).toContain('-backend-config=use_lockfile=true');
    expect(args.every((a) => a.startsWith('-backend-config='))).toBe(true);
  });
});

describe('r2CredentialsOf', () => {
  const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

  it('ID はトークンの ID、秘密はトークンの値の SHA-256。アカウントの確認が失敗したらユーザーの確認を試す', async () => {
    const urls: string[] = [];
    const fetcher = (async (url: string) => {
      urls.push(url);
      return url.includes('/accounts/') ? reply({ success: false }) : reply({ success: true, result: { id: 'tok-id' } });
    }) as unknown as typeof fetch;
    expect(await r2CredentialsOf('secret-token', 'acc', fetcher)).toEqual({ AWS_ACCESS_KEY_ID: 'tok-id', AWS_SECRET_ACCESS_KEY: createHash('sha256').update('secret-token').digest('hex') });
    expect(urls).toEqual(['https://api.cloudflare.com/client/v4/accounts/acc/tokens/verify', 'https://api.cloudflare.com/client/v4/user/tokens/verify']);
  });

  it('どちらも失敗すれば undefined（通信の失敗を含む）', async () => {
    const fetcher = (async () => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch;
    expect(await r2CredentialsOf('t', 'acc', fetcher)).toBeUndefined();
  });
});
