// 計測: 出来事の記録と集計を読むポート、Cookie なしの訪問者の鍵（記録先によらない）
// - 記録先と読み込み元のアダプターは `@ryusenkei/web/cloudflare`（Analytics Engine）と、ここの `memoryAnalytics`
// - 出来事の項目の名前と列の順は使う側の値（`defineEventSchema`）
// - 送り口（ブラウザの sendBeacon）は `@ryusenkei/web/analytics/client`

/**
 * 出来事の形。項目の順が、位置で持つ記録先の列の順（Analytics Engine の `blob1`〜、`double1`〜）
 * - 列を足すときは末尾へ。並べ替えると過去の行の意味が変わる
 * - `index`: 標本を取る単位（Analytics Engine の `index1`）。既定は空
 */
export type EventSchema<B extends string = string, D extends string = string> = Readonly<{
  blobs: readonly B[];
  doubles?: readonly D[];
  index?: (event: EventOf<B, D>) => string;
}>;

/** 出来事の値。文字列の項目と数の項目。ない項目は空（数は記録先の既定の値） */
export type EventOf<B extends string = string, D extends string = string> = Readonly<Partial<Record<B, string>> & Partial<Record<D, number>>>;

/** 項目の名前を型に残すための恒等関数 */
export const defineEventSchema = <const B extends string, const D extends string = never>(schema: EventSchema<B, D>): EventSchema<B, D> => schema;

/** 出来事の記録先。記録は待たず、失敗しても呼ぶ側の処理を止めない */
export type EventRecorder<E> = Readonly<{ record(event: E): void }>;

/**
 * 集計の条件
 * - `from`、`to`: 期間（`YYYY-MM-DD`、両端を含む）。日の区切りは `timeZone`
 * - `groupBy`: 日に加えて分ける項目。`where`: 項目の値の絞り込み（配列はどれか）
 * - `distinct`: 値の種類を数える項目（訪問者の鍵なら、重複を除いた件数）
 */
export type CountQuery<B extends string = string> = Readonly<{
  from: string;
  to: string;
  timeZone: string;
  groupBy?: readonly B[];
  where?: Readonly<Partial<Record<B, string | readonly string[]>>>;
  distinct?: B;
}>;

/** 集計の行。`keys` は `groupBy` の項目の値（ない値は空）。`distinct` は条件に `distinct` があるときだけ */
export type CountRow<B extends string = string> = Readonly<{ day: string; keys: Readonly<Partial<Record<B, string>>>; count: number; distinct?: number }>;

/** 集計の読み込み元。行は日、`groupBy` の順に並ぶ */
export type EventCounts<B extends string = string> = Readonly<{ count(query: CountQuery<B>): Promise<readonly CountRow<B>[]> }>;

/** 時間帯 `timeZone` での日付（`YYYY-MM-DD`） */
export const dayIn = (timeZone: string, at: Date | number = Date.now()): string => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

const BOT = /bot|crawl|spider|slurp|preview|monitor|headless/i;

/** bot、クローラー、リンクの展開、監視の User-Agent か（ないものは bot として扱わない） */
export const isBotUserAgent = (userAgent: string | null | undefined): boolean => BOT.test(userAgent ?? '');

/** 訪問者の鍵を計算する関数。IP アドレスがなければ空 */
export type VisitorKey = (ip: string | null | undefined, scope: string, at?: Date | number) => Promise<string>;

export type VisitorKeyOptions = Readonly<{
  /** 秘密値。未設定は isolate ごとの乱数で、重複の除外は isolate の中だけになる（匿名さは同じ） */
  secret?: string | undefined;
  /** 日を区切る時間帯 */
  timeZone: string;
  /** 日ごとの鍵を作るときの名前（ほかの用途の鍵と分ける。既定は `visitor`） */
  label?: string;
  /** 鍵の長さ（バイト、既定は3 = 16進の6文字） */
  bytes?: number;
}>;

const enc = new TextEncoder();
// 日付の境目の前後で使う、日ごとの鍵の数
const KEEP_DAYS = 2;

/**
 * Cookie なしの訪問者の鍵（同じ人の連打や再読み込みを1件に数える）
 * - 日ごとの鍵（秘密値で日付の HMAC）で、IP アドレスと範囲 `scope` の HMAC を計算し、先頭の `bytes` バイトだけを使う
 * - 日をまたぐと、同じ IP アドレスでも別の鍵になる。範囲が違う鍵は照合できない（行動を追えない）
 * - 3バイトなら1つの値に約256個の IPv4 が対応し、秘密値が漏れても IP アドレスを1つに絞れない
 * - IP アドレスは計算の中だけで使い、保存しない
 */
export function visitorKey(options: VisitorKeyOptions): VisitorKey {
  const importHmac = (raw: Uint8Array<ArrayBuffer>) => crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const root = importHmac(options.secret ? enc.encode(options.secret) : crypto.getRandomValues(new Uint8Array(32)));
  const label = options.label ?? 'visitor';
  const bytes = options.bytes ?? 3;
  const dayKeys = new Map<string, Promise<CryptoKey>>();
  const dayKeyOf = (day: string): Promise<CryptoKey> => {
    const cached = dayKeys.get(day);
    if (cached) return cached;
    const key = root.then(async (r) => importHmac(new Uint8Array(await crypto.subtle.sign('HMAC', r, enc.encode(`${label}:${day}`)))));
    dayKeys.set(day, key);
    for (const old of [...dayKeys.keys()].slice(0, -KEEP_DAYS)) dayKeys.delete(old);
    return key;
  };
  return async (ip, scope, at = Date.now()) => {
    if (!ip) return '';
    const mac = await crypto.subtle.sign('HMAC', await dayKeyOf(dayIn(options.timeZone, at)), enc.encode(`${ip}\n${scope}`));
    return Array.from(new Uint8Array(mac, 0, bytes), (b) => b.toString(16).padStart(2, '0')).join('');
  };
}

const matches = (value: string, wanted: string | readonly string[]) => (typeof wanted === 'string' ? value === wanted : wanted.includes(value));

/**
 * メモリの記録先と読み込み元（試験と手元の開発用。集計の結果は Analytics Engine の標本の補正なしの値と同じ）
 * - `events`: 記録した出来事と時刻
 */
export function memoryAnalytics<B extends string, D extends string>(schema: EventSchema<B, D>, options: Readonly<{ now?: () => Date }> = {}): EventRecorder<EventOf<B, D>> & EventCounts<B> & { readonly events: readonly { at: Date; event: EventOf<B, D> }[] } {
  const events: { at: Date; event: EventOf<B, D> }[] = [];
  const now = options.now ?? (() => new Date());
  const blob = (event: EventOf<B, D>, key: B) => (event as Partial<Record<B, string>>)[key] ?? '';
  return {
    events,
    record(event) {
      events.push({ at: now(), event });
    },
    async count(query) {
      const groupBy = query.groupBy ?? [];
      const groups = new Map<string, { day: string; keys: Partial<Record<B, string>>; count: number; values: Set<string> }>();
      for (const { at, event } of events) {
        const day = dayIn(query.timeZone, at);
        if (day < query.from || day > query.to) continue;
        if (!Object.entries(query.where ?? {}).every(([k, wanted]) => matches(blob(event, k as B), wanted as string | readonly string[]))) continue;
        const keys = Object.fromEntries(groupBy.map((k) => [k, blob(event, k)])) as Partial<Record<B, string>>;
        const id = JSON.stringify([day, ...groupBy.map((k) => keys[k])]);
        const group = groups.get(id) ?? { day, keys, count: 0, values: new Set<string>() };
        groups.set(id, group);
        group.count++;
        if (query.distinct) group.values.add(blob(event, query.distinct));
      }
      const order = (g: { day: string; keys: Partial<Record<B, string>> }) => [g.day, ...groupBy.map((k) => g.keys[k] ?? '')];
      return [...groups.values()]
        .sort((a, b) => {
          const [x, y] = [order(a), order(b)];
          const i = x.findIndex((v, n) => v !== y[n]);
          return i < 0 ? 0 : x[i]! < y[i]! ? -1 : 1;
        })
        .map((g) => ({ day: g.day, keys: g.keys, count: g.count, ...(query.distinct && { distinct: g.values.size }) }));
    },
  };
}
