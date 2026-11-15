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

  it('プログラムがなくても、宣言したメディアのサイト向けの条を出す', () => {
    const none = adDisclosure({ ...declaration, programs: [], labeling: undefined, copyright: {}, disclaimer: {} });
    expect(none.articles.map((a) => a.title)).toEqual(['著作権と引用', '免責', 'お問い合わせ先']);
    expect(none.articles[0]!.paragraphs[0]).toBe('当サイトの記事の著作権は、当社に帰属します。');
    expect(none.articles[1]!.paragraphs).toContain('当サイトから外部のサイトへのリンクについて、リンク先のサイトの内容と、そこでの取引に、当社は責任を負いません。');
  });

  describe('メディアのサイト（主語、広告の種類、編集の独立、著作権、リンク、免責、窓口）', () => {
    const media = adDisclosure({
      subject: 'Example',
      speaker: '当サイト',
      operator,
      contact: { url: '/contact' },
      programs: [],
      adTypes: [
        { kind: 'affiliate', label: '広告', position: 'after_title' },
        { kind: 'provided', label: '広告', position: 'after_title', namesSource: true },
      ],
      independence: { decidedBy: '編集部とライター' },
      copyright: { holder: '記事を執筆したライター' },
      links: { inbound: 'free' },
      disclaimer: { corrections: '記事の末尾の訂正の履歴' },
      enactedOn: '2026-11-16',
    });

    it('条の並びと前文', () => {
      expect(media.articles.map((a) => a.title)).toEqual(['広告の種類と表示', '参加している広告のプログラム', '編集の独立', '著作権と引用', 'リンク', '免責', 'お問い合わせ先']);
      expect(media.intro).toEqual(['Example（以下「本サイト」といいます。）の運営者（以下「当サイト」といいます。）は、本サイトにおける広告の掲載について、以下のとおり表示します。']);
      expect(JSON.stringify(media)).not.toContain('当社');
    });

    it('広告の種類ごとに説明と表記を出し、プログラムがなければ参加していない旨', () => {
      expect(media.articles[0]!.table).toEqual([
        { label: 'アフィリエイト', value: '本サイトのリンクから商品の購入やサービスの申し込みがあった場合に、当サイトが報酬を受け取る広告です。タイトルの直後に「広告」と表示します。' },
        { label: '製品・サービスの提供', value: '製品やサービスの無償の提供を受けて掲載する記事です。タイトルの直後に「広告」と表示します。あわせて、提供元の名前を表示します。' },
      ]);
      expect(media.articles[1]!.paragraphs).toEqual(['当サイトは現在、広告のプログラムに参加していません。']);
    });

    it('外部へのリンクの免責はリンクの条にだけ出し、窓口はフォーム', () => {
      expect(media.articles[4]!.paragraphs[1]).toContain('リンク先のサイトの内容');
      expect(media.articles[5]!.paragraphs.join('')).not.toContain('リンク先のサイトの内容');
      expect(media.articles[6]!.paragraphs[0]).toEqual(['広告の掲載に関するお問い合わせは、', { url: '/contact', text: 'お問い合わせのフォーム' }, 'からご連絡ください。']);
    });

    it('プログラムがあれば一覧を出し、編集の独立があれば「紹介する内容」の選定の段落を省く', () => {
      const withPrograms = adDisclosure({ ...declaration, independence: {} });
      expect(withPrograms.articles.map((a) => a.title)).toEqual(['参加している広告のプログラム', '広告の表記', '編集の独立', '紹介する内容', 'Cookie の使用', 'お問い合わせ先']);
      expect(withPrograms.articles[3]!.paragraphs).toHaveLength(1);
    });
  });

  it('下書きは表記の方針の未定を missing に出し、制定したのに未定なら例外', () => {
    const draft = { ...declaration, labeling: undefined, enactedOn: null };
    expect(adDisclosure(draft).missing).toEqual(['labeling']);
    expect(() => adDisclosure({ ...draft, enactedOn: '2026-11-13' })).toThrow(LegalDeclarationError);
  });
});
