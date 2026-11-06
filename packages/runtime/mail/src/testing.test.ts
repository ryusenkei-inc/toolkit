import { expect, it } from 'vitest';
import { mailerContract } from './contract.ts';
import { memoryMailer } from './testing.ts';

const mail = { from: { email: 'noreply@example.com', name: 'Site' }, to: [{ email: 'owner@example.com' }], subject: '問い合わせ', text: '本文' };

mailerContract('memoryMailer', memoryMailer, mail);

it('送ったメールを outbox に溜める', async () => {
  const mailer = memoryMailer();
  await mailer.send(mail);
  await mailer.send({ ...mail, subject: 'a\nb' });
  expect(mailer.outbox).toEqual([mail]);
});
