import { ok } from '@ryusenkei/core';
import { validateMail, type Mail, type Mailer } from './index.ts';

/** 送ったメールを `outbox` に溜めるメモリの実装（テストと dev 用） */
export function memoryMailer(): Mailer & { outbox: Mail[] } {
  const outbox: Mail[] = [];
  return {
    outbox,
    async send(mail) {
      const valid = validateMail(mail);
      if (!valid.ok) return valid;
      outbox.push(mail);
      return ok({ id: `memory-${outbox.length}` });
    },
  };
}
