// Terraform の実行の準備（Terraform 用のトークン、R2 の state の認証と backend の設定）
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

export type TerraformConfig = {
  /** state を置く R2 のバケット（会社で共有。命名は platform） */
  stateBucket: string;
  /** state のキーの接頭辞（リポの名前）。キーは `<接頭辞>/<スタックのディレクトリ名>.tfstate` */
  stateKeyPrefix: string;
  /** Terraform 用のトークンの変数（既定は `CF_TERRAFORM_TOKEN`。デプロイ用のトークンとは分ける） */
  tokenVar?: string;
};

/** `terraform` の引数から、`-chdir` のディレクトリとサブコマンドを取り出す */
export function stackOf(args: readonly string[]): { dir: string | undefined; subcommand: string | undefined; index: number } {
  let dir: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('-chdir=')) dir = a.slice('-chdir='.length);
    else if (!a.startsWith('-')) return { dir, subcommand: a, index: i };
  }
  return { dir, subcommand: undefined, index: -1 };
}

/** state のキー（`<接頭辞>/<スタック>.tfstate`） */
export const stateKeyOf = (prefix: string, dir: string | undefined, cwd: string): string => `${prefix}/${basename(dir ?? cwd)}.tfstate`;

/**
 * 部分設定の backend（`backend "s3" {}`）に渡す値。R2 は S3 互換なので AWS の検査を外し、state の lock を有効にする
 * - エンドポイントは環境変数 `AWS_ENDPOINT_URL_S3`
 */
export const backendConfigArgs = (bucket: string, key: string): string[] =>
  [
    `bucket=${bucket}`,
    `key=${key}`,
    'region=auto',
    'use_lockfile=true',
    'use_path_style=true',
    'skip_credentials_validation=true',
    'skip_region_validation=true',
    'skip_requesting_account_id=true',
    'skip_s3_checksum=true',
    'skip_metadata_api_check=true',
  ].map((v) => `-backend-config=${v}`);

/**
 * R2 の S3 互換の認証をトークンから導出する（ID はトークンの ID、秘密はトークンの値の SHA-256）
 * - アカウントのトークンとユーザーのトークンで確認の API が違うので、順に試す
 * - 導出できなければ `undefined`（`.env` に `AWS_ACCESS_KEY_ID`・`AWS_SECRET_ACCESS_KEY` を明示する）
 */
export async function r2CredentialsOf(token: string, accountId: string, fetcher: typeof fetch = fetch): Promise<{ AWS_ACCESS_KEY_ID: string; AWS_SECRET_ACCESS_KEY: string } | undefined> {
  for (const path of [`accounts/${accountId}/tokens/verify`, 'user/tokens/verify']) {
    try {
      const res = await fetcher(`https://api.cloudflare.com/client/v4/${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
      const body = (await res.json()) as { success?: boolean; result?: { id?: string } };
      if (body.success && body.result?.id) return { AWS_ACCESS_KEY_ID: body.result.id, AWS_SECRET_ACCESS_KEY: createHash('sha256').update(token).digest('hex') };
    } catch {
      // 次の確認の API を試す
    }
  }
  return undefined;
}
