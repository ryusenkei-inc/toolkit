import { describe, expect, it } from 'vitest';
import { operatorRows, privacyPolicy } from '../../web/src/legal/index.ts';
import { operator, retention, services } from './index.ts';

describe('company', () => {
  it('運営者は名称を「設立準備中」、代表者・所在地・電話番号を請求開示で出す', () => {
    expect(operatorRows(operator).map((r) => r.label)).toEqual(['運営', '名称', '所在地', '代表者', '電話番号', '窓口']);
    expect(operatorRows(operator).find((r) => r.label === '名称')?.value).toBe('設立準備中');
  });

  it('プライバシーポリシーの宣言に、そのまま渡せる', () => {
    const policy = privacyPolicy({
      subject: '例のサイト',
      operator,
      enactedOn: '2026-11-12',
      collected: [{ name: 'お問い合わせの内容', method: 'お問い合わせのフォーム', purposes: ['お問い合わせへの回答'], retention: retention.inquiry }],
      services: [{ ...services.cloudflareWorkers, items: ['お問い合わせの内容'] }],
    });
    expect(policy.articles.length).toBeGreaterThan(0);
  });
});
