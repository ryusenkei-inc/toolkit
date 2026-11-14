import { ConfigError, log, TransientError } from '@ryusenkei/core';
import type { CountQuery, CountRow, EventCounts, EventOf, EventRecorder, EventSchema } from '../analytics/index.ts';

/** Workers Analytics Engine の binding（使う部分だけの型。`@cloudflare/workers-types` に依存しない） */
export type AnalyticsEngineDataset = { writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void };

export type AnalyticsEngineRecorderOptions = {
  /** binding がないときの扱い。`ignore`（既定）は記録しない（手元の開発）、`error` は `ConfigError` を投げる */
  whenMissing?: 'ignore' | 'error';
  /** ない数の項目に入れる値（既定は0） */
  missingDouble?: number;
};

/**
 * Analytics Engine への記録（`EventRecorder`）
 * - 文字列の項目を `blob1`〜、数の項目を `double1`〜に、`schema` の順で入れる。ない文字列は空
 * - 書き込みの失敗は `analytics_write_failed` を記録して無視する（計測の欠けで応答を止めない）
 */
export function analyticsEngineRecorder<B extends string, D extends string>(binding: AnalyticsEngineDataset | undefined, schema: EventSchema<B, D>, options: AnalyticsEngineRecorderOptions = {}): EventRecorder<EventOf<B, D>> {
  const missing = options.missingDouble ?? 0;
  return {
    record(event) {
      if (!binding) {
        if (options.whenMissing === 'error') throw new ConfigError('Analytics Engine の binding が未設定');
        return;
      }
      const values = event as Partial<Record<string, string | number>>;
      try {
        binding.writeDataPoint({
          blobs: schema.blobs.map((k) => String(values[k] ?? '')),
          doubles: (schema.doubles ?? []).map((k) => Number(values[k] ?? missing)),
          ...(schema.index && { indexes: [schema.index(event)] }),
        });
      } catch (e) {
        log('warn', 'analytics_write_failed', { error: e });
      }
    },
  };
}

export type AnalyticsEngineCountsOptions<B extends string, D extends string> = {
  accountId: string;
  /** API トークン（権限は Account Analytics の読み込み） */
  token: string;
  /** データセットの名前（wrangler の `analytics_engine_datasets` の `dataset`） */
  dataset: string;
  /** 記録と同じ出来事の形 */
  schema: EventSchema<B, D>;
  /** 1回の呼び出しの時間切れ（ミリ秒、既定は5000） */
  timeoutMs?: number;
  fetch?: typeof fetch;
};

const PAGE_ROWS = 10_000;
const MAX_PAGES = 20;
const DEFAULT_TIMEOUT_MS = 5000;
const DATASET = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
// SQL に埋め込む値に許さない文字（引用符、逆斜線、制御文字）
const UNSAFE = /['\\\u0000-\u001f\u007f]/;

function checkedDate(value: string): string {
  if (!DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error(`invalid_date: ${value}`);
  return value;
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

const literal = (value: string) => {
  if (UNSAFE.test(value)) throw new Error('invalid_value');
  return `'${value}'`;
};

/**
 * Analytics Engine の SQL API による集計の読み込み元（`EventCounts`）
 * - 件数は `SUM(_sample_interval)` で標本を補正した値。`distinct` は値の種類の数で、標本を取ったときは少なめになる
 * - 日の区切りは条件の `timeZone`。書き込みから数秒〜数十秒で読める
 * - 行は1万行ずつ読み、20万行を超えたら例外（途中までの値で集計を上書きしないため）
 * - 状態が429と 5xx の応答は `TransientError`。SQL に入れる値は引用符と逆斜線と制御文字を拒む
 */
export function analyticsEngineCounts<B extends string, D extends string>(options: AnalyticsEngineCountsOptions<B, D>): EventCounts<B> {
  if (!DATASET.test(options.dataset)) throw new ConfigError('Analytics Engine のデータセットの名前が不正', { key: 'dataset' });
  const fetcher = options.fetch ?? fetch;
  const column = (key: B) => {
    const i = options.schema.blobs.indexOf(key);
    if (i < 0) throw new Error(`unknown_field: ${key}`);
    return `blob${i + 1}`;
  };
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/analytics_engine/sql`;

  async function page(sql: string): Promise<Record<string, unknown>[]> {
    const res = await fetcher(url, { method: 'POST', headers: { authorization: `Bearer ${options.token}` }, body: sql, signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300);
      if (res.status === 429 || res.status >= 500) throw new TransientError(`Analytics Engine の SQL API の失敗: ${res.status}`, { cause: text });
      throw new Error(`analytics_query_failed: ${res.status} ${text}`);
    }
    const body = (await res.json()) as { data?: unknown };
    if (!Array.isArray(body.data)) throw new Error('analytics_query_failed: no data');
    return body.data as Record<string, unknown>[];
  }

  return {
    async count(query: CountQuery<B>): Promise<readonly CountRow<B>[]> {
      if (!TIME_ZONE.test(query.timeZone)) throw new Error(`invalid_time_zone: ${query.timeZone}`);
      const [from, to] = [checkedDate(query.from), checkedDate(query.to)];
      const tz = literal(query.timeZone);
      const groupBy = query.groupBy ?? [];
      const select = [`formatDateTime(timestamp, '%Y-%m-%d', ${tz}) AS day`, ...groupBy.map((k, i) => `${column(k)} AS k${i}`), 'SUM(_sample_interval) AS events', ...(query.distinct ? [`count(DISTINCT ${column(query.distinct)}) AS uniq`] : [])];
      const where = [`timestamp >= toDateTime('${from} 00:00:00', ${tz})`, `timestamp < toDateTime('${nextDay(to)} 00:00:00', ${tz})`];
      for (const [k, wanted] of Object.entries(query.where ?? {}) as [B, string | readonly string[]][]) {
        const values = typeof wanted === 'string' ? [wanted] : wanted;
        where.push(values.length ? `(${values.map((v) => `${column(k)} = ${literal(v)}`).join(' OR ')})` : '1 = 0');
      }
      const keys = ['day', ...groupBy.map((_, i) => `k${i}`)].join(', ');
      const base = `SELECT ${select.join(', ')} FROM ${options.dataset} WHERE ${where.join(' AND ')} GROUP BY ${keys} ORDER BY ${keys}`;
      const rows: CountRow<B>[] = [];
      for (let n = 0; n < MAX_PAGES; n++) {
        const data = await page(`${base} LIMIT ${PAGE_ROWS} OFFSET ${n * PAGE_ROWS} FORMAT JSON`);
        for (const r of data) {
          const keyValues = Object.fromEntries(groupBy.map((k, i) => [k, String(r[`k${i}`] ?? '')])) as Partial<Record<B, string>>;
          rows.push({ day: String(r.day), keys: keyValues, count: Math.round(Number(r.events)), ...(query.distinct && { distinct: Number(r.uniq) }) });
        }
        if (data.length < PAGE_ROWS) return rows;
      }
      throw new Error(`analytics_rows_exceeded: ${PAGE_ROWS * MAX_PAGES}`);
    },
  };
}
