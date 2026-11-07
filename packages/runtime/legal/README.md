# @ryusenkei/legal

Builds a privacy policy, a notice under Japan's Act on Specified Commercial Transactions (`特定商取引法に基づく表記`), and the operator details for a footer from a short declaration. The output is structured data (articles, paragraphs, lists, tables) in Japanese; rendering is yours.

> The standard wording is a starting point, not legal advice. Have it reviewed before you publish.

## Install

```sh
pnpm add @ryusenkei/legal
```

## Operator

```ts
import type { Operator } from '@ryusenkei/legal';

const operator: Operator = {
  name: 'Example',
  url: 'https://www.example.com/',
  status: 'registered', // or 'preparing'
  legalName: { disclosure: 'on_request' },
  address: { disclosure: 'on_request' },
  representative: { disclosure: 'public', value: '...' },
  email: 'hi@example.com',
};
```

- Each detail is either `public` with a value, or `on_request` without one; the latter is shown as `ご請求があれば、遅滞なくお知らせします` (disclosed on request). Because an `on_request` detail carries no value, the declaration can live in a public repository without a personal name.
- `operatorRows(operator)` gives the table rows. `copyrightLine(operator, year)` gives the footer line.

## Privacy policy

Declare what you collect and which services see it:

```ts
import { privacyPolicy, retentionDaysOf } from '@ryusenkei/legal';

const declaration = {
  subject: 'Example のウェブサイト',
  operator,
  enactedOn: '2026-11-07', // null while drafting
  collected: [{ name: 'お問い合わせの内容', method: 'お問い合わせのフォーム', purposes: ['お問い合わせへの対応'], retention: { days: 365 } }],
  services: [{ name: 'Turnstile', provider: 'Cloudflare, Inc.', country: '米国', role: 'transmission', purpose: '不正な送信の防止', items: ['端末と操作の情報'] }],
  cookies: { analytics: [] },
} satisfies PrivacyDeclaration;

const doc = privacyPolicy(declaration);
const retentionDays = retentionDaysOf(declaration, 'お問い合わせの内容'); // 365, for the deletion job
```

What the declaration drives:

| Declared | Generated |
| --- | --- |
| `collected` | The items with their method and purposes, and a retention article (`{ days }`, or `{ until: 'request' }`). Multiples of 365 days are written in years |
| `services` with `role: 'processor'` | An outsourcing (`委託`) article |
| `services` with `role: 'transmission'` | What is sent, to whom, and why (external transmission from the user's device) |
| any service outside 日本 | An article on provision to third parties in foreign countries, and a security-measure line about understanding those countries' rules |
| `cookies` | The purposes and services that use cookies, or a statement that no cookies or external analytics are used |
| `revisions` | `revisedOn` (the latest) and the history |

The standard articles (disclosure, correction and suspension, security measures, contact with the operator table, changes) are always included.

Drafting:

- With `enactedOn: null`, undecided items are allowed and listed in `doc.missing`: the operator's legal name, address, and representative; retention periods; service countries.
- Setting `enactedOn` while anything is still missing throws `LegalDeclarationError`.

Keep the retention in the declaration and read it with `retentionDaysOf` in the deletion job, so the policy text and the actual deletion never disagree.

## 特定商取引法に基づく表記

```ts
import { tokushoNotice } from '@ryusenkei/legal';

const notice = tokushoNotice({
  operator: { ...operator, phone: { disclosure: 'on_request' } },
  finalConfirmationScreen: false,
  price: { disclosure: 'on_request' },
  extraFees: '...', paymentMethods: ['クレジットカード'], paymentTiming: '...', delivery: '...', returns: '...',
  updatedOn: '2026-11-07',
});
```

- When any detail is `on_request`, the notice ends with a `表示の省略について` (omitted items) row. Omission relies on the proviso of Article 11.
- With `finalConfirmationScreen: true`, the site has a final order-confirmation screen, so Article 12-6 requires every item to be shown:
  - `price` must be `public` (enforced by the type).
  - An `on_request` seller name, address, or phone throws `LegalDeclarationError`.
- A missing seller name, address, phone, or price also throws.

Terms of use are not generated; they differ too much between products.

## License

MIT
