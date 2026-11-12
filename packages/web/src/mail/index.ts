import { err, ok, type Result } from '../core/index.ts';

export type MailAddress = { email: string; name?: string };

export type Mail = {
  from: MailAddress;
  to: MailAddress[];
  replyTo?: MailAddress;
  subject: string;
  text: string;
  html?: string;
};

/**
 * メール送信の業務の失敗
 * - 基盤の失敗（送信の API の障害）は `TransientError`、送信元の未認証・binding の不足は `ConfigError` を投げる
 */
export type MailError =
  | 'invalid_input' // 宛先の形式の誤り、ヘッダーへの改行の混入（ヘッダーの差し込みを防ぐ）
  | 'rejected'; // 送信先・送信の API が受け付けない

/** メールの送信 */
export interface Mailer {
  send(mail: Mail): Promise<Result<{ id: string | undefined }, MailError>>;
}

// `RFC 5322` の厳密な検査ではなく、明らかな誤りと改行・空白の混入だけを弾く
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
// `U+0085`・`U+2028`・`U+2029` も、改行として扱うメールの処理系がある
const HEADER_BREAK = new RegExp(`[\\r\\n\\u0000${String.fromCharCode(0x85, 0x2028, 0x2029)}]`);

/** メールアドレスとして送れる形か（フォームの検査もこれを使い、送信の時に弾かれないようにする） */
export const isEmailAddress = (value: string): boolean => EMAIL.test(value);

/** 送信の前の入力の検査（実装は送る前にこれを通す） */
export function validateMail(mail: Mail): Result<void, 'invalid_input'> {
  const addresses = [mail.from, ...mail.to, ...(mail.replyTo ? [mail.replyTo] : [])];
  if (!mail.to.length) return err('invalid_input');
  if (addresses.some((a) => !isEmailAddress(a.email) || (a.name !== undefined && HEADER_BREAK.test(a.name)))) return err('invalid_input');
  if (HEADER_BREAK.test(mail.subject)) return err('invalid_input');
  return ok();
}
