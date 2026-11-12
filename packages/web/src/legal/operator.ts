import type { Paragraph, Row } from './document.ts';

/**
 * 運営者の項目の公開の仕方
 * - `public`: 値を表示する
 * - `on_request`: 表示せず、請求があれば知らせる。値を持たないので、公開のリポにも置ける
 */
export type Disclosure = Readonly<{ disclosure: 'public'; value: string }> | Readonly<{ disclosure: 'on_request' }>;

/** 運営者（会社の値。platform の `company` から渡す） */
export type Operator = Readonly<{
  /** 表示名（屋号、サービス名） */
  name: string;
  url?: string;
  /** 登記の状態。設立の準備中は正式な名称の代わりに「設立準備中」と出す */
  status: 'registered' | 'preparing';
  /** 正式な名称（商号）。未定なら下書きの間だけ省略できる */
  legalName?: Disclosure;
  representative?: Disclosure;
  address?: Disclosure;
  phone?: Disclosure;
  /** 窓口のメールアドレス（公開） */
  email: string;
}>;

/** 請求開示の項目の表示。11条ただし書の省略の条件（請求により書面か電子メールで遅滞なく提供する旨）に合わせる */
export const ON_REQUEST_TEXT = 'ご請求があれば、電子メールで遅滞なく提供します';

export const isOnRequest = (d: Disclosure | undefined): boolean => d?.disclosure === 'on_request';

const show = (d: Disclosure): string => (d.disclosure === 'public' ? d.value : ON_REQUEST_TEXT);

/**
 * 運営者の表の行（プライバシーポリシーの窓口、会社の情報の欄）
 * - 未定の項目は行を出さない
 */
export function operatorRows(operator: Operator): Row[] {
  const rows: Row[] = [{ label: '運営', value: operator.url ? [{ url: operator.url, text: operator.name }] : operator.name }];
  if (operator.legalName) rows.push({ label: '名称', value: show(operator.legalName) });
  else if (operator.status === 'preparing') rows.push({ label: '名称', value: '設立準備中' });
  if (operator.address) rows.push({ label: '所在地', value: show(operator.address) });
  if (operator.representative) rows.push({ label: '代表者', value: show(operator.representative) });
  if (operator.phone) rows.push({ label: '電話番号', value: show(operator.phone) });
  rows.push({ label: '窓口', value: [{ email: operator.email }] satisfies Paragraph });
  return rows;
}

/** フッターの著作権の表示 */
export const copyrightLine = (operator: Operator, year: number): string => `© ${year} ${operator.name}`;
