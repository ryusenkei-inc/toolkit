import { describe, expect, it } from 'vitest';
import { copyrightLine, LegalDeclarationError, operatorRows, privacyPolicy, retentionDaysOf, retentionText, tokushoNotice, type Operator, type PrivacyDeclaration, type TokushoDeclaration } from './index.ts';

const operator: Operator = {
  name: 'Example',
  url: 'https://www.example.com/',
  status: 'registered',
  legalName: { disclosure: 'on_request' },
  address: { disclosure: 'on_request' },
  representative: { disclosure: 'on_request' },
  email: 'hi@example.com',
};

const declaration: PrivacyDeclaration = {
  subject: 'Example のウェブサイト',
  operator,
  enactedOn: '2026-11-07',
  collected: [
    { name: 'お問い合わせの内容', method: 'お問い合わせのフォーム', purposes: ['お問い合わせへの対応'], retention: { days: 365 } },
    { name: 'メールアドレス', method: '先行登録', purposes: ['リリースのご案内'], retention: { until: 'request' } },
  ],
  services: [
    { name: 'Cloudflare Workers', provider: 'Cloudflare, Inc.', country: '米国', role: 'processor', purpose: 'サイトの配信と保存', items: ['アクセスの記録'] },
    { name: 'Turnstile', provider: 'Cloudflare, Inc.', country: '米国', role: 'transmission', purpose: '不正な送信の防止', items: ['端末と操作の情報'] },
  ],
};

describe('operatorRows', () => {
  it('請求開示の項目は定型の文、未定の項目は出さない', () => {
    expect(operatorRows(operator)).toEqual([
      { label: '運営', value: [{ url: 'https://www.example.com/', text: 'Example' }] },
      { label: '名称', value: 'ご請求があれば、電子メールで遅滞なく提供します' },
      { label: '所在地', value: 'ご請求があれば、電子メールで遅滞なく提供します' },
      { label: '代表者', value: 'ご請求があれば、電子メールで遅滞なく提供します' },
      { label: '窓口', value: [{ email: 'hi@example.com' }] },
    ]);
  });

  it('設立の準備中で正式な名称が未定なら「設立準備中」', () => {
    const rows = operatorRows({ name: 'Example', status: 'preparing', email: 'hi@example.com' });
    expect(rows).toContainEqual({ label: '名称', value: '設立準備中' });
    expect(copyrightLine(operator, 2026)).toBe('© 2026 Example');
  });
});

describe('privacyPolicy', () => {
  const doc = privacyPolicy(declaration);
  const titles = doc.articles.map((a) => a.title);

  it('外国のサービスがあれば、外国にある第三者への提供と委託の条文を出す', () => {
    expect(titles).toEqual(['取得する情報と利用目的', '保管期間', 'Cookie と外部への情報の送信', '個人情報等の第三者提供', '取扱いの委託', '外国にある第三者への提供', '個人情報等の開示', '個人情報等の訂正及び利用停止等', '安全管理措置の実施', 'お問い合わせ先', 'プライバシーポリシーの変更手続']);
    expect(doc.articles[5]!.paragraphs[0]).toContain('米国の Cloudflare, Inc.');
    expect(doc.articles[8]!.bullets).toContain('外国（米国）で個人情報等を取り扱う場合の、当該国の個人情報の保護に関する制度の把握');
  });

  it('保管期間は宣言の値から出し、削除の処理も同じ値を参照する', () => {
    expect(doc.articles[1]!.bullets).toEqual(['お問い合わせの内容: 1年間', 'メールアドレス: 利用者からの削除のお申し出まで']);
    expect(retentionDaysOf(declaration, 'お問い合わせの内容')).toBe(365);
    expect(retentionDaysOf(declaration, 'メールアドレス')).toBeUndefined();
    expect(retentionText({ days: 90 })).toBe('90日間');
  });

  it('外部への送信を、送信先と情報と目的で示す', () => {
    expect(doc.articles[2]!.after).toContain('Turnstile（送信先: Cloudflare, Inc.（米国））: 端末と操作の情報を、不正な送信の防止のために送信します。');
  });

  it('Cookie も外部への送信もなければ、その旨の1文', () => {
    const plain = privacyPolicy({ ...declaration, services: [] });
    expect(plain.articles.map((a) => a.title)).not.toContain('外国にある第三者への提供');
    expect(plain.articles[2]!.paragraphs).toEqual(['当サイトは、Cookie を使用していません。また、アクセスの解析や広告のために、外部のサービスへ利用者の情報を送信していません。']);
  });

  it('Cookie の目的ごとのサービスを列挙', () => {
    const withCookies = privacyPolicy({ ...declaration, services: [], cookies: { analytics: ['Cloudflare Web Analytics'], affiliate: ['A8.net'] } });
    expect(withCookies.articles[2]!.bullets).toEqual(['アクセスの解析: Cloudflare Web Analytics', 'アフィリエイトの成果の計測: A8.net']);
  });

  it('下書きは未定の項目を missing に出し、制定したのに未定があれば例外', () => {
    const draft: PrivacyDeclaration = { ...declaration, enactedOn: null, operator: { ...operator, address: undefined }, collected: [{ name: 'x', method: 'y', purposes: ['z'] }] };
    expect(privacyPolicy(draft).missing).toEqual(['operator.address', 'collected.0.retention']);
    expect(() => privacyPolicy({ ...draft, enactedOn: '2026-11-07' })).toThrow(LegalDeclarationError);
  });

  it('改定の履歴の最新を revisedOn に', () => {
    expect(privacyPolicy({ ...declaration, revisions: [{ date: '2027-01-01', note: '外部のサービスを追加' }] }).revisedOn).toBe('2027-01-01');
  });
});

describe('tokushoNotice', () => {
  const base: TokushoDeclaration = {
    operator: { ...operator, phone: { disclosure: 'on_request' } },
    finalConfirmationScreen: false,
    price: { disclosure: 'on_request' },
    extraFees: '振込手数料はお客様の負担です',
    paymentMethods: ['クレジットカード', '銀行振込'],
    paymentTiming: 'お申し込みの確定時',
    delivery: '入金の確認後、3営業日以内',
    returns: 'サービスの性質上、提供の開始後の返金はお受けできません',
    updatedOn: '2026-11-07',
  };

  it('請求開示の項目があれば「表示の省略について」を最後に足す', () => {
    const notice = tokushoNotice(base);
    expect(notice.omitted).toBe(true);
    expect(notice.rows.at(-1)?.label).toBe('表示の省略について');
    expect(notice.rows.find((r) => r.label === '販売価格')?.value).toBe('ご請求があれば、電子メールで遅滞なく提供します');
  });

  it('すべて公開なら省略の行を出さない', () => {
    const pub = { disclosure: 'public', value: '公開の値' } as const;
    const notice = tokushoNotice({ ...base, operator: { ...base.operator, legalName: pub, address: pub, phone: pub }, price: { disclosure: 'public', value: '月額1,000円（税込）' } });
    expect(notice.omitted).toBe(false);
    expect(notice.rows.map((r) => r.label)).not.toContain('表示の省略について');
  });

  it('最終確認画面があっても、価格を公開すれば販売業者の情報は省略できる', () => {
    const notice = tokushoNotice({ ...base, finalConfirmationScreen: true, price: { disclosure: 'public', value: '1,000円' } });
    expect(notice.omitted).toBe(true);
    expect(notice.rows.find((r) => r.label === '所在地')?.value).toBe('ご請求があれば、電子メールで遅滞なく提供します');
  });

  it('必要な項目がなければ例外', () => {
    expect(() => tokushoNotice({ ...base, operator: { ...base.operator, phone: undefined } })).toThrow(/電話番号/);
  });
});
