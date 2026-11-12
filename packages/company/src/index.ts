// RYUSENKEI の会社の値。@ryusenkei/web の `legal` と `form/server` に渡す
// 個人名とインフラの値（アカウントの ID、ゾーン）は入れない。代表者などは「請求があれば開示」にする
import type { ExternalService, Operator, Retention } from '@ryusenkei/web/legal';

/** 窓口のメールアドレス（問い合わせ全般、請求開示の請求先） */
export const CONTACT_EMAIL = 'hi@ryusenkei.co.jp';

/**
 * 運営者
 * - 法人の設立準備中。商号と会社の種類が決まったら `legalName` を入れ、`status` を `registered` にする
 */
export const operator = {
  name: 'RYUSENKEI',
  url: 'https://ryusenkei.co.jp',
  status: 'preparing',
  representative: { disclosure: 'on_request' },
  address: { disclosure: 'on_request' },
  phone: { disclosure: 'on_request' },
  email: CONTACT_EMAIL,
} as const satisfies Operator;

/** 保管期間の既定（プロダクトの宣言の `collected[].retention` に使う） */
export const retention = {
  /** 問い合わせ: 1年 */
  inquiry: { days: 365 },
} as const satisfies Record<string, Retention>;

/**
 * よく使う外部のサービス（プロダクトの宣言の `services` に、扱う情報の `items` を足して使う）
 * - 国は事業者の所在国。日本以外なら、プライバシーポリシーに外国にある第三者への提供の条文が出る
 */
export const services = {
  cloudflareWorkers: { name: 'Cloudflare Workers', provider: 'Cloudflare, Inc.', country: '米国', role: 'processor', purpose: 'サイトの配信とデータの処理' },
  cloudflareEmail: { name: 'Cloudflare Email Service', provider: 'Cloudflare, Inc.', country: '米国', role: 'processor', purpose: 'メールの送信' },
  turnstile: { name: 'Cloudflare Turnstile', provider: 'Cloudflare, Inc.', country: '米国', role: 'transmission', purpose: '不正な送信（bot）の判定' },
  vercel: { name: 'Vercel', provider: 'Vercel Inc.', country: '米国', role: 'processor', purpose: 'サイトの配信とデータの処理' },
  googleWorkspace: { name: 'Google Workspace', provider: 'Google LLC', country: '米国', role: 'processor', purpose: 'メールの受信と保管' },
  identityPlatform: { name: 'Identity Platform', provider: 'Google LLC', country: '米国', role: 'processor', purpose: 'ログイン（本人の確認）' },
  stripe: { name: 'Stripe', provider: 'Stripe, Inc.', country: '米国', role: 'processor', purpose: '決済' },
} as const satisfies Record<string, Omit<ExternalService, 'items'>>;

/** 窓口の既定値（`mailDestination` の送信者名と宛先。送信元のアドレスは、Email Sending を設定したプロダクトのドメインのもの） */
export const contact = {
  fromName: 'RYUSENKEI',
  to: { email: CONTACT_EMAIL, name: 'RYUSENKEI' },
} as const;
