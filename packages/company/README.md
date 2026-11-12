# @ryusenkei/company

RYUSENKEI's company values for [`@ryusenkei/web`](../web): the operator, legal defaults, and contact defaults. Products pass them to `@ryusenkei/web/legal` and `@ryusenkei/web/form/server` instead of copying them.

## Install

```sh
pnpm add @ryusenkei/company
```

## Contents

| Export | Contents | Pass to |
| --- | --- | --- |
| `operator` | The operator. The company is being set up, so the name row reads `設立準備中`; the representative, address, and phone are disclosed on request | `Operator` in `privacyPolicy`, `tokushoNotice`, `operatorRows`, `copyrightLine` |
| `retention` | Default retention periods (an inquiry is kept for a year) | `collected[].retention` |
| `services` | Common external services with their provider, country, role, and purpose. Add the `items` your product sends | `services` in `privacyPolicy` |
| `contact` | The sender name and the recipient of form notifications | `mailDestination` (the `from` address is on your product's Email Sending domain) |
| `CONTACT_EMAIL` | The contact address, also where disclosure requests go | — |

```ts
import { operator, retention, services } from '@ryusenkei/company';
import { privacyPolicy } from '@ryusenkei/web/legal';

const policy = privacyPolicy({
  subject: 'Example のウェブサイト',
  operator,
  enactedOn: '2026-11-12',
  collected: [{ name: 'お問い合わせの内容', method: 'お問い合わせのフォーム', purposes: ['お問い合わせへの対応'], retention: retention.inquiry }],
  services: [{ ...services.cloudflareWorkers, items: ['お問い合わせの内容'] }],
});
```

The same values are in `@ryusenkei/company/company.json` for repositories in other languages.

No personal names and no infrastructure values (account IDs, zones) are included.

## Versioning

Versioned separately from `@ryusenkei/web`. While the version is 0.x, a minor bump may change or remove a value.

## License

MIT
