// デプロイの後の確認: URL の一覧が期待の状態か（状態のコード、本文に含む文字、ヘッダー、転送先）
// - 期待の値は使う側が渡す。配信の反映を待つため、失敗した URL だけを間をおいて試し直す

/** 1つの URL の期待 */
export type UrlCheck = Readonly<{
  url: string;
  /** 期待の状態のコード。既定は200で、`location` を指定すると転送の状態（301、302、307、308）のどれか */
  status?: number | readonly number[];
  /** 本文に含むべき文字 */
  includes?: readonly string[];
  /** 本文に含んではいけない文字（例: 開発用の表示、mock の値） */
  excludes?: readonly string[];
  /** ヘッダーの期待（名前は小文字、値はこの文字を含む） */
  headers?: Readonly<Record<string, string>>;
  /** 転送先（相対なら `url` からの絶対 URL にして比べる）。指定すると転送をたどらない */
  location?: string;
  /** 送るヘッダー（例: 確認用のトークン） */
  requestHeaders?: Readonly<Record<string, string>>;
}>;

export type UrlCheckResult = Readonly<{ url: string; ok: boolean; status?: number; problems: readonly string[] }>;

export type CheckUrlsOptions = Readonly<{
  /** 試す回数（既定は1） */
  attempts?: number;
  /** 試し直すまでの間（ミリ秒、既定は5000） */
  intervalMs?: number;
  /** 1回の要求の時間切れ（ミリ秒、既定は10000） */
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}>;

const REDIRECTS = [301, 302, 307, 308];

/** 1つの URL を1回確かめる */
export async function checkUrl(check: UrlCheck, options: Pick<CheckUrlsOptions, 'fetch' | 'timeoutMs'> = {}): Promise<UrlCheckResult> {
  const fetcher = options.fetch ?? fetch;
  const problems: string[] = [];
  let res: Response;
  try {
    res = await fetcher(check.url, { redirect: check.location === undefined ? 'follow' : 'manual', headers: { 'cache-control': 'no-cache', ...check.requestHeaders }, signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) });
  } catch (e) {
    return { url: check.url, ok: false, problems: [`要求の失敗: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const wanted = check.status ?? (check.location === undefined ? 200 : REDIRECTS);
  if (!(typeof wanted === 'number' ? [wanted] : wanted).includes(res.status)) problems.push(`状態 ${res.status}（期待は ${typeof wanted === 'number' ? wanted : wanted.join('、')}）`);
  for (const [name, value] of Object.entries(check.headers ?? {})) {
    const actual = res.headers.get(name);
    if (actual === null || !actual.includes(value)) problems.push(`ヘッダー ${name}: ${actual ?? '(なし)'}（期待は「${value}」を含む）`);
  }
  if (check.location !== undefined) {
    const actual = res.headers.get('location');
    const expected = new URL(check.location, check.url).href;
    if (actual === null || new URL(actual, check.url).href !== expected) problems.push(`転送先 ${actual ?? '(なし)'}（期待は ${expected}）`);
  }
  if (check.includes?.length || check.excludes?.length) {
    const body = await res.text().catch(() => '');
    for (const text of check.includes ?? []) if (!body.includes(text)) problems.push(`本文に「${text}」がない`);
    for (const text of check.excludes ?? []) if (body.includes(text)) problems.push(`本文に「${text}」がある`);
  } else {
    await res.body?.cancel().catch(() => undefined);
  }
  return { url: check.url, ok: problems.length === 0, status: res.status, problems };
}

/** URL の一覧を確かめる。失敗した URL だけを `attempts` 回まで試し直す。結果は渡した順 */
export async function checkUrls(checks: readonly UrlCheck[], options: CheckUrlsOptions = {}): Promise<readonly UrlCheckResult[]> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const results: UrlCheckResult[] = new Array(checks.length);
  let pending = checks.map((_, i) => i);
  for (let attempt = 1; pending.length > 0; attempt++) {
    await Promise.all(pending.map(async (i) => (results[i] = await checkUrl(checks[i]!, options))));
    pending = pending.filter((i) => !results[i]!.ok);
    if (attempt >= (options.attempts ?? 1)) break;
    if (pending.length > 0) await sleep(options.intervalMs ?? 5000);
  }
  return results;
}

/** 結果の表示の行（成功は `ok`、失敗は理由） */
export const formatCheckResults = (results: readonly UrlCheckResult[]): string[] => results.map((r) => (r.ok ? `ok  ${r.url}` : `NG  ${r.url}: ${r.problems.join('、')}`));
