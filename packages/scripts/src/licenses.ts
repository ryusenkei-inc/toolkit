// npm の依存のライセンスの検査（`pnpm licenses list --json` の結果を、許可の一覧と照らす）

/** 許可の既定（SPDX の ID。販売する製品にも使える、著作権の表示だけを求めるライセンスと MPL-2.0） */
export const DEFAULT_ALLOWED_LICENSES: readonly string[] = ['0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0', 'ISC', 'MIT', 'MIT-0', 'MPL-2.0', 'Unicode-3.0', 'Unlicense', 'Zlib'];

/**
 * SPDX の式が許可されるか
 * - `OR` はどれか1つ、`AND` はすべて。括弧は1段まで。`WITH` の例外は ID だけで判定する
 */
export function licenseAllowed(expression: string, allowed: Iterable<string> = DEFAULT_ALLOWED_LICENSES): boolean {
  const ids = new Set(allowed);
  const body = expression.trim().replace(/^\((.*)\)$/, '$1');
  return body.split(/\s+OR\s+/).some((alt) =>
    alt.split(/\s+AND\s+/).every((term) => {
      const id = term.replace(/[()]/g, '').trim().split(/\s+WITH\s+/)[0]!;
      return ids.has(id);
    }),
  );
}

/** `pnpm licenses list --json` の形（ライセンスごとのパッケージ） */
export type LicenseListing = Readonly<Record<string, readonly Readonly<{ name: string; versions: readonly string[] }>[]>>;

export type LicenseCheckOptions = Readonly<{
  /** 許可するライセンス（既定は `DEFAULT_ALLOWED_LICENSES`） */
  allowed?: Iterable<string>;
  /** ライセンスによらず許可するパッケージの名前（確かめた理由をリポに書く） */
  ignore?: Iterable<string>;
}>;

/** 許可されない依存（`<ライセンス>: <名前>@<版>`） */
export function licenseViolations(listing: LicenseListing, options: LicenseCheckOptions = {}): string[] {
  const allowed = [...(options.allowed ?? DEFAULT_ALLOWED_LICENSES)];
  const ignore = new Set(options.ignore ?? []);
  return Object.entries(listing)
    .filter(([license]) => !licenseAllowed(license, allowed))
    .flatMap(([license, packages]) => packages.filter((p) => !ignore.has(p.name)).map((p) => `${license}: ${p.name}@${p.versions.join(',')}`));
}
