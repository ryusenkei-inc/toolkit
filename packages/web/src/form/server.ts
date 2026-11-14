// フォームの受け取りの処理（Web 標準の Request → Response。Workers、Vercel、Astro、Hono で使える）
// 順: 検査 → 回数の制限 → bot の判定 → 届け先（検査を先にし、正しい送信だけを数える）
import { classifyFailure, ConfigError, log, type ErrorReporter, type Result } from '@ryusenkei/core';
import { failureResponse, withRequestId } from '../http/index.ts';
import type { MailAddress, Mailer } from '../mail/index.ts';
import { signWebhook, type WebhookScheme, type WebhookSecrets } from '../webhook/index.ts';
import { parseForm, type Form, type FormValues } from './index.ts';

/** bot の判定（`@ryusenkei/web/turnstile` の `turnstileBotCheck` が満たす） */
export type BotCheckLike = Readonly<{
  verify(input: { token: string | null | undefined; remoteIp?: string; action?: string }): Promise<Result<void, string>>;
}>;

/** 回数の制限（`@ryusenkei/web/cloudflare` の `cloudflareRateLimiter` が満たす） */
export type RateLimiterLike = Readonly<{ limit(key: string): Promise<Result<void, string>> }>;

/** 受け取った送信。`order` は宣言の項目の順 */
export type Submission = Readonly<{ form: string; values: FormValues; order: readonly string[]; receivedAt: string }>;

/** 届け先。失敗は値で返すか、例外を投げる（どちらも「その届け先は失敗」として扱う）。`name` は届け先の間で重ならないようにする */
export type Destination = Readonly<{ name: string; deliver(submission: Submission, ctx: { requestId: string }): Promise<Result<unknown, string>> }>;

/** 届け先ごとの結果。成功は届け先が返した値、失敗は理由のコード */
export type DeliveryResult = Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false; reason: string }>;

export type SubmissionHandlerOptions = {
  /** フォームの名前ごとの宣言。複数なら、送信の `form` の値で選ぶ */
  forms: Readonly<Record<string, Form>>;
  /** フォームを選ぶ項目の名前（既定は `form`。フォームが1つなら省略できる） */
  formField?: string;
  /** 届け先。0件は設定の誤り（`503 not_configured`） */
  destinations: readonly Destination[];
  /** 受付の応答に入れる `id` を、届け先の結果（届け先の名前ごと）から選ぶ（保存先が返した受付の番号など） */
  acceptedId?: (results: Readonly<Record<string, DeliveryResult>>) => string | null | undefined;
  rateLimiter?: RateLimiterLike;
  botCheck?: BotCheckLike;
  /** bot の判定のトークンの項目（既定は Turnstile の `cf-turnstile-response`） */
  botTokenField?: string;
  /** bot の判定で照合する action */
  botAction?: string;
  /** 回数の制限のキーにする送信元の IP アドレス（既定は `cf-connecting-ip`、なければ `x-forwarded-for` の先頭） */
  clientIp?: (request: Request) => string | undefined;
  /** 本文の上限（バイト、既定は `64 KiB`） */
  maxBodyBytes?: number;
  reporter?: ErrorReporter;
  now?: () => Date;
};

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

const defaultClientIp = (request: Request) => request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined;

const json = (body: unknown, status: number, requestId: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-request-id': requestId, ...headers } });

async function readBody(request: Request, maxBytes: number): Promise<FormData | Record<string, unknown> | 'too_large' | 'invalid'> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) return 'too_large';
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maxBytes) return 'too_large';
  const type = request.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : 'invalid';
    }
    return await new Response(bytes, { headers: { 'content-type': type } }).formData();
  } catch {
    return 'invalid';
  }
}

/**
 * フォームの受け取りの処理を作る
 *
 * | 結果 | 状態 | 本文の `error` |
 * | --- | --- | --- |
 * | 受け付け（届け先の1つ以上が成功） | 200 | —（`acceptedId` があれば本文に `id`） |
 * | 本文が大きすぎる | 413 | `too_large` |
 * | 検査の失敗・フォームの名前の改変 | 400 | `invalid`（`problems` に項目ごとのコード） |
 * | 回数の上限 | 429 | `rate_limited` |
 * | bot の判定で拒否 | 403 | `bot_check_failed` |
 * | 届け先がすべて失敗 | 502 | `unavailable` |
 * | 基盤の失敗（判定の API の障害、設定の不足、届け先が0件） | 503・500 | `failureResponse` |
 */
export function submissionHandler(options: SubmissionHandlerOptions): (request: Request, ctx?: { waitUntil?(promise: Promise<unknown>): void }) => Promise<Response> {
  const formNames = Object.keys(options.forms);
  const formField = options.formField ?? 'form';
  const now = options.now ?? (() => new Date());
  return async (incoming, ctx) => {
    const { request, requestId } = withRequestId(incoming);
    if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed', requestId }, 405, requestId, { allow: 'POST' });
    try {
      if (options.destinations.length === 0) throw new ConfigError('フォームの届け先がない', { key: 'destinations' });
      const body = await readBody(request, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
      if (body === 'too_large') return json({ ok: false, error: 'too_large', requestId }, 413, requestId);
      if (body === 'invalid') return json({ ok: false, error: 'invalid', problems: [], requestId }, 400, requestId);
      const field = (name: string) => {
        const value = body instanceof FormData ? body.get(name) : body[name];
        return typeof value === 'string' ? value : undefined;
      };

      // フォームの名前は画面が決める値なので、範囲の外は改変として扱う
      const name = field(formField) ?? (formNames.length === 1 ? formNames[0] : undefined);
      if (name === undefined || !Object.hasOwn(options.forms, name)) return json({ ok: false, error: 'invalid', problems: [{ path: '', code: 'unknown_form' }], requestId }, 400, requestId);
      const form = options.forms[name]!;
      const parsed = parseForm(form, body);
      if (!parsed.ok) return json({ ok: false, error: 'invalid', problems: parsed.problems, requestId }, 400, requestId);

      const ip = (options.clientIp ?? defaultClientIp)(request);
      if (options.rateLimiter) {
        const limited = await options.rateLimiter.limit(`form:${ip ?? 'unknown'}`);
        if (!limited.ok) return json({ ok: false, error: 'rate_limited', requestId }, 429, requestId);
      }
      if (options.botCheck) {
        const human = await options.botCheck.verify({ token: field(options.botTokenField ?? 'cf-turnstile-response'), ...(ip && { remoteIp: ip }), ...(options.botAction && { action: options.botAction }) });
        if (!human.ok) return json({ ok: false, error: 'bot_check_failed', requestId }, 403, requestId);
      }

      const submission: Submission = { form: name, values: parsed.values, order: Object.keys(form.fields), receivedAt: now().toISOString() };
      const results = await Promise.all(
        options.destinations.map(async (d) => {
          try {
            const r = await d.deliver(submission, { requestId });
            return r.ok ? { name: d.name, ok: true as const, value: r.value } : { name: d.name, ok: false as const, reason: r.error };
          } catch (e) {
            return { name: d.name, ok: false as const, reason: classifyFailure(e).kind, error: e };
          }
        }),
      );
      // 入力の値はログに出さない（個人情報）
      const failed = results.filter((r) => !r.ok);
      for (const f of failed) if (!f.ok) log('warn', 'form_destination_failed', { requestId, form: name, destination: f.name, reason: f.reason, ...('error' in f && { error: f.error }) });
      if (failed.length === results.length) return json({ ok: false, error: 'unavailable', requestId }, 502, requestId);
      log('info', 'form_received', { requestId, form: name, delivered: results.filter((r) => r.ok).map((r) => r.name) });
      const byName = Object.fromEntries(results.map((r): [string, DeliveryResult] => [r.name, r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason }]));
      return json({ ok: true, requestId, ...(options.acceptedId && { id: options.acceptedId(byName) ?? null }) }, 200, requestId);
    } catch (e) {
      return failureResponse(e, { requestId, context: { stage: 'form' }, ...(options.reporter && { reporter: options.reporter }), ...(ctx?.waitUntil && { defer: (p: Promise<unknown>) => ctx.waitUntil!(p) }) });
    }
  };
}

/** 通知の本文の文言（項目の名前と選択肢の表示。辞書から渡す） */
export type NotificationCopy = Readonly<{
  labels: Readonly<Record<string, string>>;
  choices?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** 未入力の項目の表示（既定は `—`） */
  none?: string;
  /** 本文の先頭（Slack の通知の見出しなど） */
  heading?: string;
  /** 本文の末尾 */
  footer?: string;
}>;

/** 通知の本文（`■ 項目の名前` と値を、宣言の順に並べる） */
export function notificationText(submission: Submission, copy: NotificationCopy): string {
  const display = (name: string) => {
    const value = submission.values[name];
    return value ? (copy.choices?.[name]?.[value] ?? value) : (copy.none ?? '—');
  };
  const lines = submission.order.map((name) => `■ ${copy.labels[name] ?? name}\n${display(name)}`);
  return [...(copy.heading ? [copy.heading] : []), ...lines, ...(copy.footer ? [copy.footer] : [])].join('\n\n');
}

export type MailDestinationOptions = {
  mailer: Mailer;
  from: MailAddress;
  to: MailAddress | readonly MailAddress[];
  subject: (submission: Submission) => string;
  copy: NotificationCopy;
  /** 返信先（既定は送信の `email` と `name`） */
  replyTo?: (submission: Submission) => MailAddress | undefined;
};

const defaultReplyTo = (s: Submission): MailAddress | undefined => (s.values.email ? { email: s.values.email, ...(s.values.name && { name: s.values.name }) } : undefined);

/** メールで届ける（返信すると送信した人に届く） */
export function mailDestination(options: MailDestinationOptions): Destination {
  return {
    name: 'mail',
    async deliver(submission) {
      const replyTo = (options.replyTo ?? defaultReplyTo)(submission);
      return options.mailer.send({
        from: options.from,
        to: Array.isArray(options.to) ? [...options.to] : [options.to as MailAddress],
        ...(replyTo && { replyTo }),
        subject: options.subject(submission),
        text: notificationText(submission, options.copy),
      });
    },
  };
}

export type WebhookDestinationOptions = {
  url: string;
  /** 届け先の名前（既定は `webhook`。複数の webhook を送り分けるときに付ける） */
  name?: string;
  /**
   * 署名の鍵（`@ryusenkei/web/webhook` の `signWebhook`）。既定の形式はヘッダー `x-signature: t=<秒>,v1=<署名>`
   * - 配列は鍵の入れ替えの間に使い、鍵ごとの `v1` を並べる（新しい鍵を先に）
   */
  secret?: WebhookSecrets;
  /** 署名のヘッダーの名前（既定は `x-signature`） */
  signatureHeader?: string;
  /** 署名の形式（既定は `requestScheme`） */
  signatureScheme?: WebhookScheme;
  /** 本文の形（`json` は値をそのまま、`slack` は通知の本文の `text`） */
  format?: 'json' | 'slack';
  /** `slack` のときの本文の文言 */
  copy?: NotificationCopy;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

const DEFAULT_WEBHOOK_TIMEOUT_MS = 3000;

/**
 * webhook で届ける（2xx を成功とする）
 * - `json` の本文は `{ event: 'form.submitted', id, form, values, order, receivedAt }`
 * - `id` は送信ごとの UUID で、受け手の重複の判定に使う
 * - 転送（3xx）は追わない。署名と本文を、登録のない宛先へ送らないため
 */
export function webhookDestination(options: WebhookDestinationOptions): Destination {
  const fetcher = options.fetch ?? fetch;
  const secrets = (typeof options.secret === 'string' ? [options.secret] : (options.secret ?? [])).filter((s) => s);
  return {
    name: options.name ?? 'webhook',
    async deliver(submission) {
      const payload = options.format === 'slack' ? { text: notificationText(submission, options.copy ?? { labels: {} }) } : { event: 'form.submitted', id: crypto.randomUUID(), ...submission };
      const body = JSON.stringify(payload);
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (secrets.length) headers[options.signatureHeader ?? 'x-signature'] = await signWebhook(secrets, { method: 'POST', url: options.url, body }, { ...(options.signatureScheme && { scheme: options.signatureScheme }) });
      const res = await fetcher(options.url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS) });
      return res.ok ? { ok: true, value: res.status } : { ok: false, error: `status_${res.status}` };
    },
  };
}

export type HttpDestinationOptions = {
  /** 転送先の URL（未設定は `ConfigError`） */
  url: string | undefined;
  /** 届け先の名前（既定は `http`） */
  name?: string;
  /** 送るヘッダー（API の鍵など） */
  headers?: Readonly<Record<string, string>>;
  /** 本文（既定は項目の値の JSON） */
  body?: (submission: Submission) => unknown;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

/**
 * 送信を別の API へ転送する（サイトのサーバーから CMS の受け取りの口へ中継するなど）
 * - 2xx を成功とし、応答の JSON（読めなければ `null`）を届け先の値にする。`acceptedId` で受付の番号を応答に入れられる
 * - 2xx 以外は `status_<状態>` の失敗。転送（3xx）は追わない
 * - 相関の ID を `x-request-id` で渡す
 */
export function httpDestination(options: HttpDestinationOptions): Destination {
  const fetcher = options.fetch ?? fetch;
  return {
    name: options.name ?? 'http',
    async deliver(submission, ctx) {
      if (!options.url) throw new ConfigError('転送先の URL が未設定', { key: 'url' });
      const body = JSON.stringify(options.body ? options.body(submission) : submission.values);
      const headers = { ...options.headers, 'content-type': 'application/json', 'x-request-id': ctx.requestId };
      const res = await fetcher(options.url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS) });
      if (!res.ok) return { ok: false, error: `status_${res.status}` };
      return { ok: true, value: (await res.json().catch(() => null)) as unknown };
    },
  };
}
