import { describe, expect, it } from 'vitest';
import { adDisclosure, adStatements, amazonAssociates, LegalDeclarationError, type AdDisclosureDeclaration, type Operator } from './index.ts';

const operator: Operator = { name: 'Example', status: 'preparing', email: 'hi@example.com' };

const declaration: AdDisclosureDeclaration = {
  subject: 'Example のウェブサイト',
  operator,
  programs: [amazonAssociates('Example'), { name: 'A8.net', provider: '株式会社ファンコミュニケーションズ', kind: 'affiliate' }],
  labeling: { label: 'PR', position: 'top' },
  privacyPolicyUrl: 'https://www.example.com/privacy',
  enactedOn: '2026-11-13',
};

describe('adDisclosure', () => {
  const doc = adDisclosure(declaration);

  it('プログラムの一覧と、規約で決まった表記を出す', () => {
    expect(doc.title).toBe('広告の掲載について');
    expect(doc.articles.map((a) => a.title)).toEqual(['参加している広告のプログラム', '広告の表記', '紹介する内容', 'Cookie の使用', 'お問い合わせ先']);
    expect(doc.articles[0]!.bullets).toEqual(['Amazon アソシエイト・プログラム（アマゾンジャパン合同会社）: アフィリエイト', 'A8.net（株式会社ファンコミュニケーションズ）: アフィリエイト']);
    expect(doc.articles[0]!.after).toEqual(['Amazonのアソシエイトとして、Exampleは適格販売により収入を得ています。']);
    expect(adStatements(declaration)).toEqual(['Amazonのアソシエイトとして、Exampleは適格販売により収入を得ています。']);
  });

  it('表記の方針を、文言と位置で示す', () => {
    expect(doc.articles[1]!.paragraphs[0]).toBe('当サイトは、広告を含むページで、利用者が広告であると分かるように、ページの冒頭に「PR」と表記します。');
    expect(doc.articles[3]!.paragraphs[0]).toContainEqual({ url: 'https://www.example.com/privacy', text: 'プライバシーポリシー' });
  });

  it('タイアップだけなら、Cookie とリンク先の段落を出さない', () => {
    const sponsored = adDisclosure({ ...declaration, programs: [{ name: '記事広告', kind: 'sponsored' }] });
    expect(sponsored.articles.map((a) => a.title)).not.toContain('Cookie の使用');
    expect(sponsored.articles[1]!.paragraphs).toContain('広告主からの依頼による記事やリンクにも、同じく表記します。');
    expect(sponsored.articles[2]!.paragraphs).toHaveLength(1);
  });

  it('プログラムがなければ、広告を掲載していない旨とお問い合わせ先だけ', () => {
    const none = adDisclosure({ ...declaration, programs: [], labeling: undefined });
    expect(none.intro[0]).toContain('広告を掲載していません');
    expect(none.articles.map((a) => a.title)).toEqual(['お問い合わせ先']);
  });

  it('下書きは表記の方針の未定を missing に出し、制定したのに未定なら例外', () => {
    const draft = { ...declaration, labeling: undefined, enactedOn: null };
    expect(adDisclosure(draft).missing).toEqual(['labeling']);
    expect(() => adDisclosure({ ...draft, enactedOn: '2026-11-13' })).toThrow(LegalDeclarationError);
  });
});
