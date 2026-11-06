import type { ChildProcess, SpawnOptions, SpawnSyncOptions } from 'node:child_process';
import { createInterface } from 'node:readline';
import spawn from 'cross-spawn';

/**
 * 子プロセスの実行（標準入出力は親と共有、戻り値は終了コード）
 * - Windows の .cmd（pnpm・npx など）も引数を加工せずに指定、シェルの引用は cross-spawn が処理
 */
export function exec(command: string, args: string[], options: SpawnSyncOptions = {}): number {
  const { status } = spawn.sync(command, args, { stdio: 'inherit', ...options });
  return status ?? 1;
}

/** 標準出力を文字列で受け取る実行（失敗は null、標準エラーはそのまま表示） */
export function execOutput(command: string, args: string[], options: SpawnSyncOptions = {}): string | null {
  const { status, stdout } = spawn.sync(command, args, { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8', ...options });
  return status === 0 ? String(stdout).trim() : null;
}

/** 標準出力のうち keep が真の行だけを表示する実行（秘密の値を含む出力から、案内の行だけを表示） */
export function execFiltered(command: string, args: string[], keep: (line: string) => boolean): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['inherit', 'pipe', 'inherit'] });
    createInterface({ input: child.stdout! }).on('line', (line) => {
      if (keep(line)) console.log(line);
    });
    child.on('close', (status) => resolve(status ?? 1));
    child.on('error', () => resolve(1));
  });
}

/** 出力をまとめて受け取る非同期の実行（標準出力と標準エラーを1つの文字列に、並列の実行で表示を混ぜないため） */
export function execCapture(command: string, args: string[], options: SpawnOptions = {}): Promise<{ status: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('close', (status) => resolve({ status: status ?? 1, output }));
    child.on('error', (error) => resolve({ status: 1, output: `${output}${error.message}\n` }));
  });
}

/** 常駐するプロセスの起動（サーバーなど、停止は stopProcess） */
export function startProcess(command: string, args: string[], options: SpawnOptions = {}): ChildProcess {
  // detached（Windows 以外）: プロセスのグループを作成し、停止で子孫まで送信するため
  return spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', ...options });
}

/**
 * 常駐するプロセスの停止（子孫のプロセスも含む）
 * - Windows: .cmd 経由の起動は孫のプロセスが残るため、taskkill /T で木ごと停止
 * - ほか: startProcess が作成したプロセスのグループに送信
 */
export function stopProcess(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') spawn.sync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(-child.pid, 'SIGTERM');
}
