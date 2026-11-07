import { ConfigError, err, ok, TransientError } from '@ryusenkei/core';
import { validateMail, type Mail, type MailAddress, type Mailer } from '@ryusenkei/mail';

/** Email Service の `send_email` binding（使う部分だけの型） */
export type SendEmailBinding = {
  send(message: { from: MailAddress; to: MailAddress[]; replyTo?: MailAddress; subject: string; text: string; html?: string }): Promise<{ messageId: string }>;
};

// binding のエラーの `code` の分類（Email Service の Workers API の一覧）
const TRANSIENT = ['E_RATE_LIMIT_EXCEEDED', 'E_DAILY_LIMIT_EXCEEDED', 'E_INTERNAL_SERVER_ERROR'];
const CONFIG = ['E_SENDER_NOT_VERIFIED', 'E_SENDER_DOMAIN_NOT_AVAILABLE', 'E_ACCOUNT_SUSPENDED', 'E_RECIPIENT_NOT_ALLOWED'];
const REJECTED = ['E_RECIPIENT_SUPPRESSED', 'E_DELIVERY_FAILED'];
const INVALID = /^E_(VALIDATION_ERROR|FIELD_MISSING|TOO_MANY_RECIPIENTS|TOO_MANY_ATTACHMENTS|CONTENT_TOO_LARGE|HEADERS?_.+)$/;

/**
 * Email Service（Email Sending）の binding によるメール送信
 * - 送信元のドメインは Email Sending に登録済みであること（未登録は `ConfigError`）
 * - 知らないエラーコードはそのまま投げる（想定外の失敗として扱う）
 */
export function cloudflareMailer(binding: SendEmailBinding | undefined): Mailer {
  return {
    async send(mail: Mail) {
      if (!binding) throw new ConfigError('send_email の binding が未設定');
      const valid = validateMail(mail);
      if (!valid.ok) return valid;
      try {
        const { messageId } = await binding.send({ from: mail.from, to: mail.to, ...(mail.replyTo ? { replyTo: mail.replyTo } : {}), subject: mail.subject, text: mail.text, ...(mail.html ? { html: mail.html } : {}) });
        return ok({ id: messageId });
      } catch (e) {
        const code = (e as { code?: unknown }).code;
        if (typeof code !== 'string') throw e;
        if (TRANSIENT.includes(code)) throw new TransientError(`メール送信の一時的な失敗: ${code}`, { cause: e });
        if (CONFIG.includes(code)) throw new ConfigError(`メール送信の設定の誤り: ${code}`, { cause: e });
        if (REJECTED.includes(code)) return err('rejected');
        if (INVALID.test(code)) return err('invalid_input');
        throw e;
      }
    },
  };
}
