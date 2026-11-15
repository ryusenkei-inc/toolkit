// 広告の掲載についての表示（ステルスマーケティングの規制の表示、参加しているプログラムの記載）を宣言から組み立てる
// 表示の方針は、消費者庁の「一般消費者が事業者の表示であることを判別することが困難である表示」の運用基準に沿う
// メディアのサイト向けの条（広告の種類と表示、編集の独立、著作権と引用、リンク、免責）は、宣言にあるものだけを出す
// 定型の文面は公開の前に人が確認する（文面の正しさは、このパッケージでは保証しない）
import { LegalDeclarationError, type Article, type LegalDocument, type Paragraph, type Revision } from './document.ts';
import { contactSentence, operatorRows, type Contact, type Operator } from './operator.ts';
import { voiceOf } from './voice.ts';

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
 * - `position`: `top` はページの冒頭、`after_title` はタイトルの直後、`near_link` は広告のリンクや枠の近く
 *   `both` はページの冒頭と広告のリンクや枠の近く
 */
export type AdLabeling = Readonly<{ label: string; position: 'top' | 'after_title' | 'near_link' | 'both' }>;

/**
 * 掲載することがある広告の種類と、その表記（「広告の種類と表示」の条）
 * - `kind`: プログラムの種類に加え、`provided` は製品やサービスの無償の提供を受けた記事
 * - `namesSource`: 表記に加えて、広告主や提供元の名前を出す
 */
export type AdType = AdLabeling & Readonly<{ kind: AdProgram['kind'] | 'provided'; namesSource?: boolean }>;

export type AdDisclosureDeclaration = Readonly<{
  /** 対象（例: 「〇〇のウェブサイト」） */
  subject: string;
  /** 対象の呼び方（既定は「当サイト」。`speaker` が「当サイト」なら「本サイト」） */
  subjectShort?: string;
  /** 本文の主語（例: 「当サイト」）。指定すると前文で運営者をこの名前で定義する。既定は「当社」 */
  speaker?: string;
  operator: Operator;
  /** お問い合わせの受け付け先（既定は運営者のメールアドレス） */
  contact?: Contact;
  programs: readonly AdProgram[];
  /** 未定なら下書きの間だけ省略できる。広告を掲載しない、または `adTypes` で種類ごとに表記を決めるなら不要 */
  labeling?: AdLabeling;
  /** プライバシーポリシーの URL。あれば成果の計測の Cookie の段落からリンクする */
  privacyPolicyUrl?: string;
  /** 掲載するものの呼び方（既定は「記事」）。編集の独立、著作権と引用、リンク、免責の条で使う */
  contentName?: string;
  /** 掲載することがある広告の種類。あれば「広告の種類と表示」の条を出し、プログラムがなくても広告を掲載する前提で書く */
  adTypes?: readonly AdType[];
  /** 編集の独立の条。`decidedBy` は企画と執筆を判断する人（例: 「編集部とライター」。既定は主語） */
  independence?: Readonly<{ decidedBy?: string }>;
  /** 著作権と引用の条。`holder` は著作権の帰属先（例: 「記事を執筆したライター」。既定は主語） */
  copyright?: Readonly<{ holder?: string }>;
  /** リンクの条。`inbound` は対象へのリンクの扱い（`free` は許可が不要、`ask` は事前の連絡を求める） */
  links?: Readonly<{ inbound: 'free' | 'ask' }>;
  /** 免責の条。`corrections` は誤りの訂正を知らせる場所（例: 「記事の末尾の訂正の履歴」） */
  disclaimer?: Readonly<{ corrections?: string }>;
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
  after_title: 'タイトルの直後',
  near_link: '広告のリンクや枠の近く',
  both: 'ページの冒頭と、広告のリンクや枠の近く',
};

const TYPE_TEXT: Record<AdType['kind'], string> = {
  affiliate: 'アフィリエイト',
  advertising: '広告の配信',
  sponsored: '依頼を受けた記事',
  provided: '製品・サービスの提供',
};

const SOURCE_TEXT: Record<AdType['kind'], string> = {
  affiliate: 'プログラムの事業者',
  advertising: '広告主',
  sponsored: '依頼元',
  provided: '提供元',
};

/** プログラムの規約で決まった表記の一覧（フッターなど、広告の掲載についてのページ以外にも出すとき） */
export const adStatements = (d: Pick<AdDisclosureDeclaration, 'programs'>): string[] => d.programs.flatMap((p) => (p.statement ? [p.statement] : []));

type Voice = ReturnType<typeof voiceOf>;

/** 広告の種類の説明（表の値の前半） */
function typeText(kind: AdType['kind'], { site, op }: Voice): string {
  switch (kind) {
    case 'affiliate':
      return `${site}のリンクから商品の購入やサービスの申し込みがあった場合に、${op}が報酬を受け取る広告です。`;
    case 'advertising':
      return '広告の枠に、配信事業者が選んだ広告を表示します。';
    case 'sponsored':
      return '企業などの依頼を受け、対価を得て掲載する記事やリンクです。';
    case 'provided':
      return '製品やサービスの無償の提供を受けて掲載する記事です。';
  }
}

/** 広告の種類と表示の条 */
const adTypesArticle = (adTypes: readonly AdType[], v: Voice): Article => ({
  title: '広告の種類と表示',
  paragraphs: [`${v.site}には、以下の種類の広告を掲載することがあります。広告を含むページには、利用者が広告であると分かるように表示します。`],
  table: adTypes.map((t) => ({
    label: TYPE_TEXT[t.kind],
    value: `${typeText(t.kind, v)}${POSITION_TEXT[t.position]}に「${t.label}」と表示します。${t.namesSource ? `あわせて、${SOURCE_TEXT[t.kind]}の名前を表示します。` : ''}`,
  })),
});

/** 編集の独立の条（宣言になければ空） */
function independenceArticles(d: AdDisclosureDeclaration, { site, op }: Voice): Article[] {
  if (!d.independence) return [];
  const content = d.contentName ?? '記事';
  return [
    {
      title: '編集の独立',
      paragraphs: [
        `${site}の${content}は、${d.independence.decidedBy ?? op}の判断で企画し、執筆しています。広告主や広告のプログラムの事業者が、${content}のテーマ、評価、掲載の可否に関与することはありません。`,
        `報酬の有無や金額によって、${content}での評価を変えることはありません。`,
      ],
    },
  ];
}

/** 著作権と引用、リンク、免責の条（宣言にあるものだけ） */
function rightsArticles(d: AdDisclosureDeclaration, { site, op }: Voice): Article[] {
  const content = d.contentName ?? '記事';
  const external = `${site}から外部のサイトへのリンクについて、リンク先のサイトの内容と、そこでの取引に、${op}は責任を負いません。`;
  const articles: Article[] = [];
  if (d.copyright) {
    articles.push({
      title: '著作権と引用',
      paragraphs: [
        `${site}の${content}の著作権は、${d.copyright.holder ?? op}に帰属します。`,
        `法令で認められる範囲を超えて、${content}の全部または一部を無断で転載することを禁じます。`,
        `${content}を引用する場合は、出典として${content}のタイトルと URL を明記してください。`,
      ],
    });
  }
  if (d.links) {
    articles.push({
      title: 'リンク',
      paragraphs: [
        d.links.inbound === 'free'
          ? `${site}へのリンクに許可は必要ありません。ただし、${site}の${content}であることを誤認させる形式のリンクはお断りします。`
          : `${site}へのリンクを希望する場合は、事前にお問い合わせください。`,
        external,
      ],
    });
  }
  if (d.disclaimer) {
    articles.push({
      title: '免責',
      paragraphs: [
        `${site}の${content}は、公開または更新の時点の情報に基づきます。その後の変更により、現在の情報と異なる場合があります。`,
        ...(d.disclaimer.corrections ? [`${content}の誤りは、${d.disclaimer.corrections}で修正の内容をお知らせします。`] : []),
        ...(d.links ? [] : [external]),
        `${site}の情報を利用して生じた損害について、${op}は、故意または重大な過失による場合を除き、責任を負いません。`,
      ],
    });
  }
  return articles;
}

/**
 * 広告の掲載についての表示を組み立てる
 * - プログラムも `adTypes` もなければ、広告を掲載していない旨と、宣言したメディアのサイト向けの条と、お問い合わせ先を出す
 * - 制定日があるのに未定の項目（プログラムがあるのに表記の方針がない）が残っていれば `LegalDeclarationError`
 */
export function adDisclosure(d: AdDisclosureDeclaration): LegalDocument {
  const programs = d.programs;
  const adTypes = d.adTypes ?? [];
  const missing = programs.length && !adTypes.length && !d.labeling ? ['labeling'] : [];
  if (d.enactedOn && missing.length) throw new LegalDeclarationError('制定した広告の掲載についての表示に未定の項目がある', missing);

  const v = voiceOf(d);
  const { site, op, actor } = v;
  const has = (kind: AdProgram['kind']) => programs.some((p) => p.kind === kind);
  const statements = adStatements(d);
  const independence = independenceArticles(d, v);
  const rights = rightsArticles(d, v);
  const contact: Article = {
    title: 'お問い合わせ先',
    paragraphs: [contactSentence('広告の掲載に関するお問い合わせは、', d.operator, d.contact)] satisfies Paragraph[],
    table: operatorRows(d.operator, { contact: d.contact }),
  };
  const revisions = d.revisions ?? [];
  const base = { title: '広告の掲載について', enactedOn: d.enactedOn, revisedOn: revisions[0]?.date, revisions, missing };
  const lead = v.intro('における広告の掲載について、以下のとおり表示します。');

  if (!programs.length && !adTypes.length) {
    const none = `${actor}は、広告を掲載していません。また、紹介する商品やサービスの事業者から、紹介の対価を受け取っていません。`;
    return { ...base, intro: d.speaker ? [lead, none] : [none], articles: [...independence, ...rights, contact] };
  }

  const selection = [
    ...(d.independence ? [] : [`${site}で紹介する商品やサービスの選定と評価は、${op}の判断によるものです。報酬の有無によって評価を変えることはありません。`]),
    ...(has('affiliate') ? ['商品の価格、在庫、仕様などはリンク先で変わることがあります。購入の前に、リンク先のサイトでご確認ください。商品の購入などの契約は、利用者とリンク先の事業者との間で成立します。'] : []),
  ];

  const articles: Article[] = [
    ...(adTypes.length ? [adTypesArticle(adTypes, v)] : []),
    programs.length
      ? {
          title: '参加している広告のプログラム',
          paragraphs: [`${actor}は、以下の広告のプログラムに参加し、広告を掲載しています。`],
          bullets: programs.map((p) => `${p.name}${p.provider ? `（${p.provider}）` : ''}: ${KIND_TEXT[p.kind]}`),
          ...(statements.length && { after: statements }),
        }
      : { title: '参加している広告のプログラム', paragraphs: [`${actor}は現在、広告のプログラムに参加していません。`] },
    ...(programs.length && !adTypes.length
      ? [
          {
            title: '広告の表記',
            paragraphs: [
              `${actor}は、広告を含むページで、利用者が広告であると分かるように、${POSITION_TEXT[d.labeling?.position ?? 'top']}に「${d.labeling?.label ?? '（未定）'}」と表記します。`,
              ...(has('affiliate') ? [`アフィリエイトのリンクから商品の購入やサービスの申し込みがあった場合、${op}はプログラムの事業者から報酬を受け取ることがあります。`] : []),
              ...(has('sponsored') ? ['広告主からの依頼による記事やリンクにも、同じく表記します。'] : []),
            ],
          },
        ]
      : []),
    ...independence,
    ...(programs.length && selection.length ? [{ title: '紹介する内容', paragraphs: selection }] : []),
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
    ...rights,
    contact,
  ];

  return { ...base, intro: [lead], articles };
}
