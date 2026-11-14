// デプロイのロック: 同じ時間帯に2か所（別のセッション、別の端末）から本番を変えないため
// - 置き場所はポート `LockStore`。アダプターは R2（`r2LockStore`）と GCS（`gcsLockStore`）
// - 内容は持ち主と開始の日時の JSON。古いロック（`staleMs` を過ぎたもの）は、途中で止まったデプロイの残りとみなして上書きする
// - 書き込みは条件つき（ないときだけ作る、読んだ版のときだけ上書き）なので、同時に取りにいっても1つだけが取れる
import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';

/** 保存済みのロックと、その版（R2 は ETag、GCS は generation） */
export type StoredLock = Readonly<{ content: string; version: string }>;

/** 終了の処理の中で同期で送る HTTP の要求 */
export type HttpRequestInit = Readonly<{ url: string; method: string; headers: Readonly<Record<string, string>> }>;

/** ロックの置き場所 */
export type LockStore = Readonly<{
  /** 説明（エラーの文に出す。例: `r2://bucket/deploy.lock`） */
  name: string;
  /** 保存済みのロック。なければ `null` */
  read(): Promise<StoredLock | null>;
  /** 書く。`ifVersion` が `null` ならないときだけ、あればその版のときだけ。条件が合わなければ `null`、書けたら書いた後の版 */
  write(content: string, ifVersion: string | null): Promise<string | null>;
  /** 消す（ないときは何もしない） */
  remove(): Promise<void>;
  /** 消す要求（プロセスの終了の処理で同期で送るため） */
  removeRequest(): HttpRequestInit;
}>;

/** ロックの内容 */
export type DeployLockInfo = Readonly<{ owner: string; at: string }>;

/** 古いとみなす既定の経過の時間（60分） */
export const DEFAULT_STALE_MS = 60 * 60_000;

/**
 * 保存済みの内容の判定
 * - `free`: ロックなし、壊れた内容、古いロック（`stale` に持ち主）。上書きしてよい
 * - `held`: ほかのデプロイが実行中
 */
export function lockStateOf(
  content: string | null | undefined,
  options: Readonly<{ now?: () => number; staleMs?: number }> = {},
): Readonly<{ kind: 'free'; stale?: DeployLockInfo } | { kind: 'held'; lock: DeployLockInfo }> {
  const now = (options.now ?? Date.now)();
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  if (!content?.trim()) return { kind: 'free' };
  let lock: DeployLockInfo;
  try {
    const parsed = JSON.parse(content) as Partial<DeployLockInfo>;
    if (typeof parsed.owner !== 'string' || typeof parsed.at !== 'string' || Number.isNaN(Date.parse(parsed.at))) return { kind: 'free' };
    lock = { owner: parsed.owner, at: parsed.at };
  } catch {
    return { kind: 'free' };
  }
  return now - Date.parse(lock.at) > staleMs ? { kind: 'free', stale: lock } : { kind: 'held', lock };
}

export type DeployLockOptions = {
  /** 持ち主の表示（既定は `<ホスト名>:<PID>`。コミットを足すと見分けやすい） */
  owner?: string;
  /** 古いとみなす経過の時間（ミリ秒、既定は60分。デプロイの最長の所要時間の約2倍にする） */
  staleMs?: number;
  /**
   * プロセスの終了でロックを消す（既定は真）
   * - `process.exit` を含む終了で、同期の HTTP の要求で消す。Ctrl+C（SIGINT）は終了の状態130で終了の処理へ回す
   */
  releaseOnExit?: boolean;
  now?: () => number;
};

/** 取れたロック */
export type DeployLock = DeployLockInfo & Readonly<{
  /** 上書きした古いロック */
  stale?: DeployLockInfo;
  /** ロックを消す。ほかの持ち主に上書きされていたら消さない */
  release(): Promise<void>;
}>;

export type AcquireResult = Readonly<{ kind: 'acquired'; lock: DeployLock } | { kind: 'held'; lock: DeployLockInfo }>;

/** ほかのデプロイが実行中（`withDeployLock` が投げる） */
export class DeployLockHeldError extends Error {
  readonly lock: DeployLockInfo;
  constructor(store: LockStore, lock: DeployLockInfo) {
    super(`ほかのデプロイが実行中: ${lock.owner}（${lock.at} から）。終わってから実行するか、止まったデプロイの残りなら ${store.name} を削除`);
    this.name = 'DeployLockHeldError';
    this.lock = lock;
  }
}

/** ロックを取る。ほかのデプロイが実行中なら `held` */
export async function acquireDeployLock(store: LockStore, options: DeployLockOptions = {}): Promise<AcquireResult> {
  const now = options.now ?? Date.now;
  const owner = options.owner ?? `${hostname()}:${process.pid}`;
  // 2回目は、同時に取りにいって負けたときの読み直し
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await store.read();
    const state = lockStateOf(existing?.content, options);
    if (state.kind === 'held') return state;
    const at = new Date(now()).toISOString();
    const version = await store.write(JSON.stringify({ owner, at }), existing?.version ?? null);
    if (version === null) continue;
    return { kind: 'acquired', lock: heldLock(store, { owner, at, ...(state.stale && { stale: state.stale }) }, version, options.releaseOnExit ?? true) };
  }
  const latest = await store.read();
  const state = lockStateOf(latest?.content, options);
  return { kind: 'held', lock: state.kind === 'held' ? state.lock : { owner: '(不明)', at: new Date(now()).toISOString() } };
}

function heldLock(store: LockStore, info: DeployLockInfo & { stale?: DeployLockInfo }, version: string, releaseOnExit: boolean): DeployLock {
  let released = false;
  const onExit = () => {
    if (!released) sendSync(store.removeRequest());
  };
  const onSigint = () => process.exit(130);
  if (releaseOnExit) {
    process.on('exit', onExit);
    process.once('SIGINT', onSigint);
  }
  return {
    ...info,
    async release() {
      if (released) return;
      released = true;
      if (releaseOnExit) {
        process.off('exit', onExit);
        process.off('SIGINT', onSigint);
      }
      const current = await store.read();
      if (current?.version === version) await store.remove();
    },
  };
}

/** ロックを取って `fn` を実行し、終わったら消す。ほかのデプロイが実行中なら `DeployLockHeldError` */
export async function withDeployLock<T>(store: LockStore, fn: (lock: DeployLock) => Promise<T> | T, options: DeployLockOptions = {}): Promise<T> {
  const result = await acquireDeployLock(store, options);
  if (result.kind === 'held') throw new DeployLockHeldError(store, result.lock);
  try {
    return await fn(result.lock);
  } finally {
    await result.lock.release();
  }
}

// 子の node で要求を送り、終わるまで待つ（終了の処理の中では非同期の処理が動かないため）
const SEND = "let s='';process.stdin.on('data',(c)=>(s+=c)).on('end',async()=>{const r=JSON.parse(s);try{await fetch(r.url,{method:r.method,headers:r.headers,signal:AbortSignal.timeout(10000)})}catch{process.exitCode=1}})";

/** HTTP の要求を同期で送る（失敗は無視） */
export function sendSync(request: HttpRequestInit): void {
  spawnSync(process.execPath, ['-e', SEND], { input: JSON.stringify(request), stdio: ['pipe', 'ignore', 'ignore'], timeout: 15_000 });
}
