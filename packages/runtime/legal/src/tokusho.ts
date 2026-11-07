// 特定商取引法に基づく表記を宣言から組み立てる
// 省略（請求があれば開示）は11条ただし書による。申込の最終確認画面を持つと12条の6で全項目の表示が要るので、省略を使えない
// 定型の文面は公開の前に人が確認する（文面の正しさは、このパッケージでは保証しない）
import { LegalDeclarationError, type Paragraph, type Row } from './document.ts';
import { isOnRequest, ON_REQUEST_TEXT, type Disclosure, type Operator } from './operator.ts';

type Common = Readonly<{
  operator: Operator;
  /** 運営の責任者（任意） */
  responsiblePerson?: Disclosure;
  /** 商品代金以外の必要料金 */
  extraFees: string;
  paymentMethods: readonly string[];
  paymentTiming: string;
  /** 商品の引渡し、サービスの提供の時期 */
  delivery: string;
  /** 返品・キャンセル */
  returns: string;
  installments?: string;
  /** 動作環境（ソフトウェア、デジタルの商品） */
  environment?: string;
  /** 最終の更新日（YYYY-MM-DD） */
  updatedOn: string;
}>;

/**
 * 特商法の表記の宣言
 * - `finalConfirmationScreen: true`（サイトに申込の最終確認画面がある）なら、価格は公開が必須（型で防ぐ）。販売業者の項目は実行時に検査する
 */
export type TokushoDeclaration =
  | (Common & Readonly<{ finalConfirmationScreen: true; price: Readonly<{ disclosure: 'public'; value: string }> }>)
  | (Common & Readonly<{ finalConfirmationScreen: false; price: Disclosure }>);

export type TokushoNotice = Readonly<{ title: string; rows: readonly Row[]; updatedOn: string; omitted: boolean }>;

const show = (d: Disclosure): string => (d.disclosure === 'public' ? d.value : ON_REQUEST_TEXT);

/**
 * 特商法の表記を組み立てる
 * - 「請求があれば開示」の項目が1つでもあれば、「表示の省略について」の行を最後に足す
 * - 最終確認画面があるのに省略した項目があれば `LegalDeclarationError`
 */
export function tokushoNotice(d: TokushoDeclaration): TokushoNotice {
  const o = d.operator;
  // 販売業者は正式な名称（個人の事業なら氏名）。請求開示にもできる
  const seller = o.legalName;
  const fields: [string, Disclosure | undefined][] = [
    ['販売業者', seller],
    ['所在地', o.address],
    ['電話番号', o.phone],
    ['運営責任者', d.responsiblePerson],
    ['販売価格', d.price],
  ];
  const missing = fields.filter(([label, v]) => !v && label !== '運営責任者').map(([label]) => label);
  if (missing.length) throw new LegalDeclarationError('特商法の表記に必要な項目がない', missing);
  const omittedLabels = fields.filter(([, v]) => isOnRequest(v)).map(([label]) => label);
  if (d.finalConfirmationScreen && omittedLabels.length) throw new LegalDeclarationError('申込の最終確認画面があると省略できない（12条の6）', omittedLabels);

  const rows: Row[] = [
    { label: '販売業者', value: `${o.name}\n${show(seller!)}` },
    { label: '所在地', value: show(o.address!) },
    { label: '電話番号', value: show(o.phone!) },
    ...(d.responsiblePerson ? [{ label: '運営責任者', value: show(d.responsiblePerson) }] : []),
    { label: 'メールアドレス', value: [{ email: o.email }] satisfies Paragraph },
    { label: '販売価格', value: show(d.price) },
    { label: '商品代金以外の必要料金', value: d.extraFees },
    { label: '支払方法', value: d.paymentMethods.join('\n') },
    ...(d.installments ? [{ label: '分割払い', value: d.installments }] : []),
    { label: '支払時期', value: d.paymentTiming },
    { label: '引渡し・提供の時期', value: d.delivery },
    { label: '返品・キャンセル', value: d.returns },
    ...(d.environment ? [{ label: '動作環境', value: d.environment }] : []),
  ];
  const omitted = omittedLabels.length > 0;
  if (omitted) rows.push({ label: '表示の省略について', value: '本表記に記載のない事項、および「ご請求があれば、遅滞なくお知らせします」とした事項は、ご請求があれば、お申し込みのご判断に先立って遅滞なく、書面または電子メールで提供します。' });
  return { title: '特定商取引法に基づく表記', rows, updatedOn: d.updatedOn, omitted };
}
