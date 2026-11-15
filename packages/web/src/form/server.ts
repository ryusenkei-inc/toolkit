// フォームの受け取りの処理（Web 標準の Request → Response。Workers、Vercel、Astro、Hono で使える）
// 順: 検査 → 主体の認証 → 回数の制限 → bot の判定 → 1回だけの確保 → 日ごとの上限 → 届け先（検査を先にし、正しい送信だけを数える）
import { classifyFailure, ConfigError, err, log, ok, UsageError, type ErrorReporter, type Result } from '@ryusenkei/core';
import { failureResponse, REQUEST_ID_HEADER, withRequestId } from '../http/index.ts';
import type { MailAddress, Mailer } from '../mail/index.ts';
import { jwtFromRequest, type JwtClaims, type JwtVerifier } from '../oidc/index.ts';
import { signWebhook, type WebhookScheme, type WebhookSecrets } from '../webhook/index.ts';
import { parseForm, type Form, type FormValues } from './index.ts';

/** bot の判定に渡す値 */
export type BotCheckInput = Readonly<{ token: string | null | undefined; remoteIp?: string; action?: string }>;

/**
 * bot の判定のポート（`@ryusenkei/web/turnstile` の `turnstileBotCheck` が実装）
 * - 業務の失敗は `E` のコードで返し、判定の API の障害は `TransientError`、設定の不足は `ConfigError` を投げる
 */
export type BotCheck<E extends string = string> = Readonly<{ verify(input: BotCheckInput): Promise<Result<void, E>> }>;

/** キー（IP アドレスなど）ごとの回数の制限のポート（`@ryusenkei/web/cloudflare` の `cloudflareRateLimiter` が実装） */
export type RateLimiter<E extends string = string> = Readonly<{ limit(key: string): Promise<Result<void, E>> }>;

/** 主体の認証に渡す値。`field` は本文の項目の文字列の値 */
export type AuthenticateInput = Readonly<{ request: Request; field(name: string): string | undefined }>;

/**
 * 認証を通った主体
 * - `credential`: 認証に使ったトークン（ID トークンなど）。届け先が自分で検証し直すときに `httpDestination` の `credential` で渡す
 */
export type Authenticated = Readonly<{ subject: string; credential?: string }>;

/**
 * 送信した主体（LINE のユーザーなど）の認証のポート（`jwtAuthenticator` が実装）
 * - 認証できなければ `E` のコードで返し、検証の API の障害は `TransientError`、設定の不足は `ConfigError` を投げる
 */
export type Authenticator<E extends string = string> = Readonly<{ authenticate(input: AuthenticateInput): Promise<Result<Authenticated, E>> }>;

/**
 * 主体ごとに1回だけ受け付けるためのポート
 * - 実装: `@ryusenkei/web/cloudflare` の `d1SubmissionOnce`
 * - 試験と手元の開発の実装: `@ryusenkei/web/form/testing` の `memorySubmissionOnce`
 * - `scope` は受け付けの単位（既定はフォームの名前）、`subject` は認証した主体
 * - `claim` は同時の送信でも1つだけが成功する。届け先がすべて失敗したら `release` で戻す
 * - `has` は、画面を開いたときの「回答済みか」の問い合わせにも使う
 */
export type SubmissionOnce = Readonly<{
  has(scope: string, subject: string): Promise<boolean>;
  claim(scope: string, subject: string): Promise<Result<void, 'duplicate'>>;
  release(scope: string, subject: string): Promise<void>;
}>;

/**
 * キーごとの日ごとの受付の上限のポート
 * - 実装: `@ryusenkei/web/cloudflare` の `d1DailyQuota`
 * - 試験と手元の開発の実装: `@ryusenkei/web/form/testing` の `memoryDailyQuota`
 * - `take` は、その日の数が `limit` 未満なら1つ数えて成功する。日の区切りの時間帯は実装を作るときに渡す
 */
export type DailyQuota = Readonly<{ take(key: string, limit: number): Promise<Result<void, 'quota_exceeded'>> }>;

/** 回数の制限と日ごとの上限のキーを決める関数に渡す値 */
export type SubmissionKeyInput = Readonly<{ ip: string | undefined; form: string; subject: string | undefined }>;

/**
 * 受け取った送信
 * - `order` は宣言の項目の順、`subject` は認証した主体（`authenticator` があるとき）
 * - `credential` は認証に使ったトークン（`Authenticated` の `credential`）。ログと `webhookDestination` の本文には出さない
 */
export type Submission = Readonly<{ form: string; values: FormValues; order: readonly string[]; receivedAt: string; subject?: string; credential?: string }>;

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
  /** 送信した主体の認証。認証できなければ `401 unauthenticated` */
  authenticator?: Authenticator;
  rateLimiter?: RateLimiter;
  /** 回数の制限のキー（既定は `form:<送信元の IP アドレス>`、IP アドレスがなければ `form:unknown`） */
  rateLimitKey?: (input: SubmissionKeyInput) => string;
  botCheck?: BotCheck;
  /** bot の判定のトークンの項目（既定は Turnstile の `cf-turnstile-response`） */
  botTokenField?: string;
  /** bot の判定で照合する action */
  botAction?: string;
  /**
   * 主体ごとに1回だけ受け付ける（`authenticator` が要る）。2回目は `409 already_submitted`
   * - `scope`: 受け付けの単位（既定はフォームの名前）
   */
  once?: Readonly<{ store: SubmissionOnce; scope?: (input: Readonly<{ form: string }>) => string }>;
  /**
   * 日ごとの受付の上限。超えたら `429 quota_exceeded`
   * - `key`: 数える単位（既定は `form:<フォームの名前>`。主体や IP アドレスごとにもできる）
   */
  quota?: Readonly<{ store: DailyQuota; limit: number; key?: (input: SubmissionKeyInput) => string }>;
  /** 回数の制限のキーにする送信元の IP アドレス（既定は `cf-connecting-ip`、なければ `x-forwarded-for` の先頭） */
  clientIp?: (request: Request) => string | undefined;
  /** 本文の上限（バイト、既定は `64 KiB`） */
  maxBodyBytes?: number;
  reporter?: ErrorReporter;
  /** 今の時刻（ミリ秒）を返す関数（既定は `Date.now`） */
  now?: () => number;
};

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

const defaultClientIp = (request: Request) => request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined;

const json = (body: unknown, status: number, requestId: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', [REQUEST_ID_HEADER]: requestId, ...headers } });

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
 * | 主体を認証できない | 401 | `unauthenticated` |
 * | 回数の上限 | 429 | `rate_limited` |
 * | bot の判定で拒否 | 403 | `bot_check_failed` |
 * | 同じ主体の2回目 | 409 | `already_submitted` |
 * | 日ごとの上限 | 429 | `quota_exceeded` |
 * | 届け先がすべて失敗 | 502 | `unavailable` |
 * | 基盤の失敗（判定の API の障害、設定の不足、届け先が0件） | 503・500 | `failureResponse` |
 *
 * - `once` があるのに `authenticator` がなければ、作るときに `UsageError`（`once_without_authenticator`）
 * - 1回だけの確保の後に日ごとの上限で断るか、届け先がすべて失敗したら、確保を戻す（もう一度送れる）
 */
export function submissionHandler(options: SubmissionHandlerOptions): (request: Request, ctx?: { waitUntil?(promise: Promise<unknown>): void }) => Promise<Response> {
  if (options.once && !options.authenticator) throw new UsageError('once_without_authenticator', '1回だけの受け付けには authenticator が要る');
  const formNames = Object.keys(options.forms);
  const formField = options.formField ?? 'form';
  const now = options.now ?? Date.now;
  const rateLimitKey = options.rateLimitKey ?? (({ ip }) => `form:${ip ?? 'unknown'}`);
  const quotaKey = options.quota?.key ?? (({ form }) => `form:${form}`);
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

      let subject: string | undefined;
      let credential: string | undefined;
      if (options.authenticator) {
        const auth = await options.authenticator.authenticate({ request, field });
        if (!auth.ok) return json({ ok: false, error: 'unauthenticated', requestId }, 401, requestId);
        ({ subject, credential } = auth.value);
      }
      const ip = (options.clientIp ?? defaultClientIp)(request);
      const keyInput: SubmissionKeyInput = { ip, form: name, subject };
      if (options.rateLimiter) {
        const limited = await options.rateLimiter.limit(rateLimitKey(keyInput));
        if (!limited.ok) return json({ ok: false, error: 'rate_limited', requestId }, 429, requestId);
      }
      if (options.botCheck) {
        const human = await options.botCheck.verify({ token: field(options.botTokenField ?? 'cf-turnstile-response'), ...(ip && { remoteIp: ip }), ...(options.botAction && { action: options.botAction }) });
        if (!human.ok) return json({ ok: false, error: 'bot_check_failed', requestId }, 403, requestId);
      }

      // 確保した後に断るときは戻す。戻せなくても応答は変えない（ログに残す）
      let release = async (): Promise<void> => {};
      if (options.once && subject !== undefined) {
        const { store } = options.once;
        const scope = options.once.scope?.({ form: name }) ?? name;
        const claimed = await store.claim(scope, subject);
        if (!claimed.ok) return json({ ok: false, error: 'already_submitted', requestId }, 409, requestId);
        const who = subject;
        release = () => store.release(scope, who).catch((e: unknown) => log('warn', 'form_once_release_failed', { requestId, form: name, error: e }));
      }
      if (options.quota) {
        let taken: Result<void, 'quota_exceeded'>;
        try {
          taken = await options.quota.store.take(quotaKey(keyInput), options.quota.limit);
        } catch (e) {
          await release();
          throw e;
        }
        if (!taken.ok) {
          await release();
          return json({ ok: false, error: 'quota_exceeded', requestId }, 429, requestId);
        }
      }

      const submission: Submission = { form: name, values: parsed.values, order: Object.keys(form.fields), receivedAt: new Date(now()).toISOString(), ...(subject !== undefined && { subject }), ...(credential !== undefined && { credential }) };
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
      if (failed.length === results.length) {
        await release();
        return json({ ok: false, error: 'unavailable', requestId }, 502, requestId);
      }
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
  /** 複数選択の値の区切り（既定は `、`） */
  separator?: string;
  /** 本文の先頭（Slack の通知の見出しなど） */
  heading?: string;
  /** 本文の末尾 */
  footer?: string;
}>;

/** 通知の本文（`■ 項目の名前` と値を、宣言の順に並べる） */
export function notificationText(submission: Submission, copy: NotificationCopy): string {
  const label = (name: string, value: string) => copy.choices?.[name]?.[value] ?? value;
  const display = (name: string) => {
    const value = submission.values[name];
    if (!value || value.length === 0) return copy.none ?? '—';
    return typeof value === 'string' ? label(name, value) : value.map((v) => label(name, v)).join(copy.separator ?? '、');
  };
  const lines = submission.order.map((name) => `■ ${copy.labels[name] ?? name}\n${display(name)}`);
  return [...(copy.heading ? [copy.heading] : []), ...lines, ...(copy.footer ? [copy.footer] : [])].join('\n\n');
}

export type MailDestinationOptions = {
  mailer: Mailer;
  /** 届け先の名前（既定は `mail`。複数のメールの届け先を送り分けるときに付ける） */
  name?: string;
  from: MailAddress;
  to: MailAddress | readonly MailAddress[];
  subject: (submission: Submission) => string;
  copy: NotificationCopy;
  /** 返信先（既定は送信の `email` と `name`） */
  replyTo?: (submission: Submission) => MailAddress | undefined;
};

const defaultReplyTo = ({ values: { email, name } }: Submission): MailAddress | undefined => (typeof email === 'string' && email ? { email, ...(typeof name === 'string' && name && { name }) } : undefined);

/** メールで届ける（返信すると送信した人に届く） */
export function mailDestination(options: MailDestinationOptions): Destination {
  return {
    name: options.name ?? 'mail',
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
   * - 署名しないときは項目ごと省く。項目があって値が空（未設定の環境変数など）なら `ConfigError`
   */
  secret?: WebhookSecrets | undefined;
  /** 署名のヘッダーの名前（既定は `x-signature`） */
  header?: string;
  /** 署名の形式（既定は `requestScheme`） */
  scheme?: WebhookScheme;
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
 * - `json` の本文は `{ event: 'form.submitted', id, form, values, order, receivedAt, subject? }`
 * - 認証のトークン（`credential`）は本文に入れない
 * - `id` は送信ごとの UUID で、受け手の重複の判定に使う
 * - 転送（3xx）は追わない。署名と本文を、登録のない宛先へ送らないため
 */
export function webhookDestination(options: WebhookDestinationOptions): Destination {
  const fetcher = options.fetch ?? fetch;
  const signed = Object.hasOwn(options, 'secret');
  const secrets = (typeof options.secret === 'string' ? [options.secret] : (options.secret ?? [])).filter((s) => s);
  return {
    name: options.name ?? 'webhook',
    async deliver(submission) {
      if (signed && !secrets.length) throw new ConfigError('webhook の署名の鍵が未設定', { key: 'secret' });
      const { credential: _, ...fields } = submission;
      const payload = options.format === 'slack' ? { text: notificationText(submission, options.copy ?? { labels: {} }) } : { event: 'form.submitted', id: crypto.randomUUID(), ...fields };
      const body = JSON.stringify(payload);
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (signed) headers[options.header ?? 'x-signature'] = await signWebhook(secrets, { method: 'POST', url: options.url, body }, { ...(options.scheme && { scheme: options.scheme }) });
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
  /**
   * 認証に使ったトークン（`Submission` の `credential`）を転送先へ渡す。転送先が自分で検証し直すときに使う
   * - `{ field }`: 本文の項目に入れる（本文はオブジェクトに限る）
   * - `{ header }`: ヘッダーに入れる（`authorization` は `Bearer <token>`）
   */
  credential?: Readonly<{ field: string }> | Readonly<{ header: string }>;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

/**
 * 送信を別の API へ転送する（サイトのサーバーから CMS の受け取りの口へ中継するなど）
 * - 2xx を成功とし、応答の JSON（読めなければ `null`）を届け先の値にする。`acceptedId` で受付の番号を応答に入れられる
 * - 2xx 以外は `status_<状態>` の失敗。転送（3xx）は追わない
 * - 相関の ID を `x-request-id` で渡す
 * - `credential` があるのに送信にトークンがなければ `ConfigError`（`key: 'credential'`）
 * - `credential` の `field` で、本文がオブジェクトでなければ `UsageError`（`credential_field_needs_object`）
 */
export function httpDestination(options: HttpDestinationOptions): Destination {
  const fetcher = options.fetch ?? fetch;
  return {
    name: options.name ?? 'http',
    async deliver(submission, ctx) {
      if (!options.url) throw new ConfigError('転送先の URL が未設定', { key: 'url' });
      let payload = options.body ? options.body(submission) : submission.values;
      const extra: Record<string, string> = {};
      if (options.credential) {
        const token = submission.credential;
        if (!token) throw new ConfigError('転送する認証のトークンがない（authenticator がトークンを返さない）', { key: 'credential' });
        if ('field' in options.credential) {
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new UsageError('credential_field_needs_object', '認証のトークンを入れる本文がオブジェクトでない');
          payload = { ...payload, [options.credential.field]: token };
        } else {
          const name = options.credential.header;
          extra[name] = name.toLowerCase() === 'authorization' ? `Bearer ${token}` : token;
        }
      }
      const body = JSON.stringify(payload);
      const headers = { ...options.headers, ...extra, 'content-type': 'application/json', [REQUEST_ID_HEADER]: ctx.requestId };
      const res = await fetcher(options.url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS) });
      if (!res.ok) return { ok: false, error: `status_${res.status}` };
      return { ok: true, value: (await res.json().catch(() => null)) as unknown };
    },
  };
}

/** `afterDelivery` の続きの処理に渡す値。`value` は届け先が返した値 */
export type AfterDeliveryInput = Readonly<{ submission: Submission; value: unknown; requestId: string }>;

/**
 * 届け先の成功の後に処理を続ける（保存の成功の後にだけ送る LINE の Push など）
 * - 届け先が失敗したら続きを呼ばない
 * - 続きの失敗はログ（`form_after_delivery_failed`）に出し、届け先の結果は変えない（保存は済んでいるため）
 * - 名前は元の届け先と同じ
 */
export function afterDelivery(destination: Destination, then: (input: AfterDeliveryInput) => Promise<void>): Destination {
  return {
    name: destination.name,
    async deliver(submission, ctx) {
      const result = await destination.deliver(submission, ctx);
      if (!result.ok) return result;
      try {
        await then({ submission, value: result.value, requestId: ctx.requestId });
      } catch (e) {
        log('warn', 'form_after_delivery_failed', { requestId: ctx.requestId, form: submission.form, destination: destination.name, error: e });
      }
      return result;
    },
  };
}

export type JwtAuthenticatorOptions = {
  /** トークンを読む本文の項目（既定は `idToken`。`header` だけを使うなら `null`） */
  field?: string | null;
  /** トークンを読むヘッダー（`@ryusenkei/web/oidc` の `jwtFromRequest`）。本文の項目より先に見る */
  header?: string | readonly string[];
  /** クレームから主体を取り出す（既定は `sub`） */
  subject?: (claims: JwtClaims) => string | undefined;
};

/**
 * JWT（LINE の ID トークンなど）で送信した主体を認証する（`Authenticator`）
 * - 検証は `@ryusenkei/web/oidc` の `jwtVerifier`・`lineIdTokenVerifier` に任せる
 * - トークンがない、検証を通らない、主体が取れないときは `unauthenticated`
 * - 検証を通ったトークンを `credential` で返す（`httpDestination` の `credential` で転送先へ渡せる）
 */
export function jwtAuthenticator(verifier: JwtVerifier, options: JwtAuthenticatorOptions = {}): Authenticator<'unauthenticated'> {
  const field = options.field === undefined ? 'idToken' : options.field;
  const subjectOf = options.subject ?? ((claims: JwtClaims) => (typeof claims.sub === 'string' ? claims.sub : undefined));
  return {
    async authenticate(input) {
      const token = (options.header && jwtFromRequest(input.request, options.header)) || (field !== null ? input.field(field) : undefined);
      const verified = await verifier.verify(token);
      if (!verified.ok) return err('unauthenticated');
      const subject = subjectOf(verified.value);
      return subject && token ? ok({ subject, credential: token }) : err('unauthenticated');
    },
  };
}
