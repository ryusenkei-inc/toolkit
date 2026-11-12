// プライバシーポリシーを宣言から組み立てる（日本語、敬体、前文と第 N 条の形）
// 定型の文面は公開の前に人が確認する（文面の正しさは、このパッケージでは保証しない）
import { LegalDeclarationError, type Article, type LegalDocument, type Paragraph, type Revision } from './document.ts';
import { operatorRows, type Operator } from './operator.ts';

/**
 * 保管期間。日数は削除の処理からも `retentionDaysOf` で参照する
 * - `months`: 外部のサービスの保存の期間が月で決まっているとき（例: 3か月で消えるログ）
 * - `until: 'request'`: 利用者からの削除のお申し出まで
 * - `until: 'purpose'`: 利用目的の達成に必要な期間（期限を決めずに、目的を終えたら消す情報）
 */
export type Retention = Readonly<{ days: number }> | Readonly<{ months: number }> | Readonly<{ until: 'request' | 'purpose' }>;

/** 集める情報 */
export type CollectedItem = Readonly<{
  /** 情報の名前（例: 「お問い合わせの内容」） */
  name: string;
  /** 取得の方法（例: 「お問い合わせのフォーム」） */
  method: string;
  purposes: readonly string[];
  /** 未定なら下書きの間だけ省略できる */
  retention?: Retention;
}>;

/**
 * 外部のサービス
 * - `processor`: 取扱いの委託（サーバー、メールの配信など）
 * - `transmission`: 利用者の端末から外部へ送られる情報（解析、広告、bot の判定などのタグ）
 */
export type ExternalService = Readonly<{
  name: string;
  provider: string;
  /** 事業者の国（例: 「米国」）。日本以外なら外国にある第三者への提供の条文を出す。未定なら下書きの間だけ省略できる */
  country?: string;
  role: 'processor' | 'transmission';
  purpose: string;
  /** 扱う、または送られる情報 */
  items: readonly string[];
}>;

export type PrivacyDeclaration = Readonly<{
  /** 対象（例: 「〇〇のウェブサイト」） */
  subject: string;
  /** 対象の呼び方（既定は「当サイト」） */
  subjectShort?: string;
  operator: Operator;
  /** 制定日（YYYY-MM-DD）。`null` は下書きで、未定の項目を `missing` に出す */
  enactedOn: string | null;
  /** 改定の履歴（新しい順） */
  revisions?: readonly Revision[];
  collected: readonly CollectedItem[];
  services?: readonly ExternalService[];
  /** Cookie を使う目的ごとのサービス名。どれもなければ「使用していません」と出す */
  cookies?: Readonly<{ analytics?: readonly string[]; advertising?: readonly string[]; affiliate?: readonly string[] }>;
}>;

const JAPAN = '日本';

/** 保管期間の表示（365日の倍数は年、それ以外は日、月は月） */
export function retentionText(retention: Retention): string {
  if ('until' in retention) return retention.until === 'request' ? '利用者からの削除のお申し出まで' : '利用目的の達成に必要な期間';
  if ('months' in retention) return `${retention.months}か月間`;
  const { days } = retention;
  return days % 365 === 0 ? `${days / 365}年間` : `${days}日間`;
}

/** 削除の処理が参照する保管期間（日）。日数でない、または未定なら `undefined` */
export function retentionDaysOf(declaration: Pick<PrivacyDeclaration, 'collected'>, name: string): number | undefined {
  const retention = declaration.collected.find((c) => c.name === name)?.retention;
  return retention && 'days' in retention ? retention.days : undefined;
}

function missingOf(d: PrivacyDeclaration): string[] {
  const missing: string[] = [];
  if (!d.operator.legalName && d.operator.status === 'registered') missing.push('operator.legalName');
  if (!d.operator.address) missing.push('operator.address');
  if (!d.operator.representative) missing.push('operator.representative');
  d.collected.forEach((c, i) => void (!c.retention && missing.push(`collected.${i}.retention`)));
  (d.services ?? []).forEach((s, i) => void (!s.country && missing.push(`services.${i}.country`)));
  return missing;
}

/**
 * プライバシーポリシーを組み立てる
 * - 外部のサービスに日本以外の国があれば、外国にある第三者への提供の条文と、安全管理措置の外的環境の把握を出す
 * - 制定日があるのに未定の項目が残っていれば `LegalDeclarationError`
 */
export function privacyPolicy(d: PrivacyDeclaration): LegalDocument {
  const missing = missingOf(d);
  if (d.enactedOn && missing.length) throw new LegalDeclarationError('制定したプライバシーポリシーに未定の項目がある', missing);

  const site = d.subjectShort ?? '当サイト';
  const services = d.services ?? [];
  const processors = services.filter((s) => s.role === 'processor');
  const transmissions = services.filter((s) => s.role === 'transmission');
  const foreign = services.filter((s) => s.country && s.country !== JAPAN);
  const countries = [...new Set(foreign.map((s) => s.country!))];
  const cookieUses = Object.entries({ アクセスの解析: d.cookies?.analytics, 広告の配信: d.cookies?.advertising, アフィリエイトの成果の計測: d.cookies?.affiliate }).filter(([, names]) => names?.length) as [string, readonly string[]][];
  const at = (s: ExternalService) => `${s.provider}${s.country ? `（${s.country}）` : ''}`;

  const articles: Article[] = [
    {
      title: '取得する情報と利用目的',
      paragraphs: [`当社は、${site}で以下の情報を取得し、それぞれの目的で利用します。`],
      bullets: d.collected.map((c) => `${c.name}（${c.method}）: ${c.purposes.join('、')}`),
      after: ['当社は、利用者の同意を得ることなく、上記の目的の範囲を超えて個人情報等を利用しません。'],
    },
    {
      title: '保管期間',
      paragraphs: ['当社は、取得した情報を以下の期間保管し、期間を過ぎた情報は遅滞なく消去します。'],
      bullets: d.collected.map((c) => `${c.name}: ${c.retention ? retentionText(c.retention) : '（未定）'}`),
    },
    cookieUses.length || transmissions.length
      ? {
          title: 'Cookie と外部への情報の送信',
          paragraphs: [
            ...(cookieUses.length ? [`${site}は、以下の目的で Cookie を使用します。利用者は、ブラウザーの設定で Cookie を無効にできます。`] : [`${site}は、Cookie を使用していません。`]),
          ],
          ...(cookieUses.length && { bullets: cookieUses.map(([use, names]) => `${use}: ${names.join('、')}`) }),
          ...(transmissions.length && {
            after: [`${site}は、以下のサービスのために、利用者の端末から外部へ情報を送信します。`, ...transmissions.map((s) => `${s.name}（送信先: ${at(s)}）: ${s.items.join('、')}を、${s.purpose}のために送信します。`)],
          }),
        }
      : { title: 'Cookie と外部への情報の送信', paragraphs: [`${site}は、Cookie を使用していません。また、アクセスの解析や広告のために、外部のサービスへ利用者の情報を送信していません。`] },
    {
      title: '個人情報等の第三者提供',
      paragraphs: ['当社は、以下の場合を除き、あらかじめ利用者の同意を得ることなく、個人情報等を第三者に提供しません。'],
      items: [
        '利用目的の達成に必要な範囲で、個人情報等の取扱いの全部または一部を委託する場合',
        '合併その他の事由による事業の承継に伴って個人情報等が提供される場合',
        '国の機関もしくは地方公共団体またはその委託を受けた者が法令の定める事務を遂行することに対して協力する必要がある場合であって、利用者の同意を得ることにより当該事務の遂行に支障を及ぼすおそれがあるとき',
        'その他、法令で認められる場合',
      ],
    },
    ...(processors.length
      ? [{ title: '取扱いの委託', paragraphs: ['当社は、利用目的の達成に必要な範囲で、以下の事業者に個人情報等の取扱いを委託し、委託先を適切に監督します。'], bullets: processors.map((s) => `${at(s)}: ${s.purpose}（${s.items.join('、')}）`) }]
      : []),
    ...(foreign.length
      ? [
          {
            title: '外国にある第三者への提供',
            paragraphs: [
              `当社は、${[...new Set(foreign.map((s) => `${s.country}の ${s.provider}`))].join('、')} に個人情報等の取扱いを委託し、または個人情報等を提供します。この場合、法令に従い、当該国の個人情報の保護に関する制度を把握した上で、必要な措置を講じます。講じている措置の内容は、ご請求があれば遅滞なくお知らせします。`,
            ],
          },
        ]
      : []),
    {
      title: '個人情報等の開示',
      paragraphs: ['当社は、利用者から個人情報の保護に関する法律の定めに基づき個人情報等の開示を求められたときは、利用者ご本人からのご請求であることを確認の上で、遅滞なく開示します（開示すべき個人情報等が存在しないときは、その旨を通知します）。ただし、法令により開示の義務を負わない場合は、この限りではありません。'],
    },
    {
      title: '個人情報等の訂正及び利用停止等',
      paragraphs: [
        '当社は、利用者から、個人情報等が真実でないという理由によって訂正を求められた場合、または利用目的の範囲を超えて取り扱われているという理由もしくは不正の手段により取得されたという理由によって利用の停止もしくは消去を求められた場合には、利用者ご本人からのご請求であることを確認の上で遅滞なく必要な調査を行い、その結果に基づき、訂正、利用の停止または消去を行い、その旨を利用者に通知します。',
        '前項の規定は、法令により当社が訂正、利用の停止または消去の義務を負わない場合は、適用しません。',
      ],
    },
    {
      title: '安全管理措置の実施',
      paragraphs: ['当社は、個人情報等の漏えい、滅失または毀損の防止のため、以下の措置を講じます。'],
      bullets: [
        '個人情報等の取扱いの責任者の設置と、取扱いの状況の定期的な点検',
        '個人情報等を取り扱う者への秘密の保持の義務づけ',
        '個人情報等を扱う権限の限定と、アクセスの制御',
        '通信の暗号化',
        '委託先との秘密の保持に関する取り決めと、委託先の監督',
        ...(countries.length ? [`外国（${countries.join('、')}）で個人情報等を取り扱う場合の、当該国の個人情報の保護に関する制度の把握`] : []),
      ],
    },
    {
      title: 'お問い合わせ先',
      paragraphs: [['本ポリシーに関するご意見、ご質問、個人情報等の取扱いに関するお問い合わせは、', { email: d.operator.email }, 'までご連絡ください。']] satisfies Paragraph[],
      table: operatorRows(d.operator),
    },
    {
      title: 'プライバシーポリシーの変更手続',
      paragraphs: [`当社は、本ポリシーの内容を適宜見直し、その改善に努めます。本ポリシーは、法令に別段の定めがある場合を除き、変更することができます。変更後の本ポリシーは、${site}に掲載した時から効力を生じます。`],
    },
  ];

  const revisions = d.revisions ?? [];
  return {
    title: 'プライバシーポリシー',
    intro: [`当社は、${d.subject}（以下「${site}」といいます。）の運営にあたり取得した利用者の個人情報等の取扱いについて、以下のとおりプライバシーポリシー（以下「本ポリシー」といいます。）を定めます。`],
    articles,
    enactedOn: d.enactedOn,
    revisedOn: revisions[0]?.date,
    revisions,
    missing,
  };
}
