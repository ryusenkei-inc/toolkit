// 広告の掲載についての表示（ステルスマーケティングの規制の表示、参加しているプログラムの記載）を宣言から組み立てる
// 表示の方針は、消費者庁の「一般消費者が事業者の表示であることを判別することが困難である表示」の運用基準に沿う
// 定型の文面は公開の前に人が確認する（文面の正しさは、このパッケージでは保証しない）
import { LegalDeclarationError, type Article, type LegalDocument, type Paragraph, type Revision } from './document.ts';
import { operatorRows, type Operator } from './operator.ts';

/**
 * 広告のプログラム
 * - `affiliate`: アフィリエイト（紹介した商品の購入などの成果に応じて報酬を受け取る）
 * - `advertising`: 広告の配信（広告の枠に配信事業者の広告を表示する）
 * - `sponsored`: 広告主からの依頼による記事やリンク（タイアップ）
 */
export type AdProgram = Readonly<{
  name: string;
  /** 運営する事業者 */
  provider?: string;
  kind: 'affiliate' | 'advertising' | 'sponsored';
  /** プログラムの規約で決まった表記。そのまま出す（例: Amazon アソシエイトの表記） */
  statement?: string;
}>;

/**
 * 記事の中の広告の表記
 * - `label`: 表記の文言（例: 「広告」「PR」）
 * - `position`: `top` はページの冒頭、`near_link` は広告のリンクや枠の近く、`both` は両方
 */
export type AdLabeling = Readonly<{ label: string; position: 'top' | 'near_link' | 'both' }>;

export type AdDisclosureDeclaration = Readonly<{
  /** 対象（例: 「〇〇のウェブサイト」） */
  subject: string;
  /** 対象の呼び方（既定は「当サイト」） */
  subjectShort?: string;
  operator: Operator;
  programs: readonly AdProgram[];
  /** 未定なら下書きの間だけ省略できる。広告を掲載しないなら不要 */
  labeling?: AdLabeling;
  /** プライバシーポリシーの URL。あれば成果の計測の Cookie の段落からリンクする */
  privacyPolicyUrl?: string;
  /** 制定日（YYYY-MM-DD）。`null` は下書きで、未定の項目を `missing` に出す */
  enactedOn: string | null;
  /** 改定の履歴（新しい順） */
  revisions?: readonly Revision[];
}>;

/**
 * Amazon アソシエイト・プログラム
 * - `who`: 表記の主語（サイト名、または運営者の名前）
 */
export const amazonAssociates = (who: string): AdProgram => ({
  name: 'Amazon アソシエイト・プログラム',
  provider: 'アマゾンジャパン合同会社',
  kind: 'affiliate',
  // 規約が定める文言。空白や句読点を変えない
  statement: `Amazonのアソシエイトとして、${who}は適格販売により収入を得ています。`,
});

const KIND_TEXT: Record<AdProgram['kind'], string> = {
  affiliate: 'アフィリエイト',
  advertising: '広告の配信',
  sponsored: '広告主からの依頼による掲載',
};

const POSITION_TEXT: Record<AdLabeling['position'], string> = {
  top: 'ページの冒頭',
  near_link: '広告のリンクや枠の近く',
  both: 'ページの冒頭と、広告のリンクや枠の近く',
};

/** プログラムの規約で決まった表記の一覧（フッターなど、広告の掲載についてのページ以外にも出すとき） */
export const adStatements = (d: Pick<AdDisclosureDeclaration, 'programs'>): string[] => d.programs.flatMap((p) => (p.statement ? [p.statement] : []));

/**
 * 広告の掲載についての表示を組み立てる
 * - プログラムがなければ、広告を掲載していない旨とお問い合わせ先だけを出す
 * - 制定日があるのに未定の項目（プログラムがあるのに表記の方針がない）が残っていれば `LegalDeclarationError`
 */
export function adDisclosure(d: AdDisclosureDeclaration): LegalDocument {
  const programs = d.programs;
  const missing = programs.length && !d.labeling ? ['labeling'] : [];
  if (d.enactedOn && missing.length) throw new LegalDeclarationError('制定した広告の掲載についての表示に未定の項目がある', missing);

  const site = d.subjectShort ?? '当サイト';
  const has = (kind: AdProgram['kind']) => programs.some((p) => p.kind === kind);
  const statements = adStatements(d);
  const contact: Article = {
    title: 'お問い合わせ先',
    paragraphs: [['広告の掲載に関するお問い合わせは、', { email: d.operator.email }, 'までご連絡ください。']] satisfies Paragraph[],
    table: operatorRows(d.operator),
  };
  const revisions = d.revisions ?? [];
  const base = { title: '広告の掲載について', enactedOn: d.enactedOn, revisedOn: revisions[0]?.date, revisions, missing };

  if (!programs.length) {
    return { ...base, intro: [`${site}は、広告を掲載していません。また、紹介する商品やサービスの事業者から、紹介の対価を受け取っていません。`], articles: [contact] };
  }

  const articles: Article[] = [
    {
      title: '参加している広告のプログラム',
      paragraphs: [`${site}は、以下の広告のプログラムに参加し、広告を掲載しています。`],
      bullets: programs.map((p) => `${p.name}${p.provider ? `（${p.provider}）` : ''}: ${KIND_TEXT[p.kind]}`),
      ...(statements.length && { after: statements }),
    },
    {
      title: '広告の表記',
      paragraphs: [
        `${site}は、広告を含むページで、利用者が広告であると分かるように、${POSITION_TEXT[d.labeling?.position ?? 'top']}に「${d.labeling?.label ?? '（未定）'}」と表記します。`,
        ...(has('affiliate') ? ['アフィリエイトのリンクから商品の購入やサービスの申し込みがあった場合、当社はプログラムの事業者から報酬を受け取ることがあります。'] : []),
        ...(has('sponsored') ? ['広告主からの依頼による記事やリンクにも、同じく表記します。'] : []),
      ],
    },
    {
      title: '紹介する内容',
      paragraphs: [
        `${site}で紹介する商品やサービスの選定と評価は、当社の判断によるものです。報酬の有無によって評価を変えることはありません。`,
        ...(has('affiliate') ? ['商品の価格、在庫、仕様などはリンク先で変わることがあります。購入の前に、リンク先のサイトでご確認ください。商品の購入などの契約は、利用者とリンク先の事業者との間で成立します。'] : []),
      ],
    },
    ...(has('affiliate') || has('advertising')
      ? [
          {
            title: 'Cookie の使用',
            paragraphs: [
              d.privacyPolicyUrl
                ? ['成果の計測や広告の配信のために、プログラムの事業者が Cookie を使用することがあります。詳しくは', { url: d.privacyPolicyUrl, text: 'プライバシーポリシー' }, 'をご覧ください。']
                : '成果の計測や広告の配信のために、プログラムの事業者が Cookie を使用することがあります。',
            ] satisfies Paragraph[],
          },
        ]
      : []),
    contact,
  ];

  return { ...base, intro: [`当社は、${d.subject}（以下「${site}」といいます。）における広告の掲載について、以下のとおり表示します。`], articles };
}
