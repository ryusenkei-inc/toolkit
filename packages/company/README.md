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
| `copyright(options?)`, `copyrightHtml(options?)` | The copyright notice `© RYUSENKEI` (no year), with a link to the company site by default | The site footer |

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

### Copyright notice

Every product site shows the same notice, `© RYUSENKEI`, without a year. By default the name links to the company site; pass `{ link: false }` for plain text.

```ts
import { copyright, copyrightHtml } from '@ryusenkei/company';

copyrightHtml();                  // '© <a href="https://ryusenkei.co.jp/">RYUSENKEI</a>'
copyrightHtml({ link: false });   // '© RYUSENKEI'
copyright();                      // { text: '© RYUSENKEI', prefix: '© ', name: 'RYUSENKEI', href: 'https://ryusenkei.co.jp/' }
```

In Astro or React, build it from `copyright()` to add your own attributes:

```astro
---
import { copyright } from '@ryusenkei/company';
const c = copyright();
---
<small>{c.prefix}{c.href ? <a href={c.href}>{c.name}</a> : c.name}</small>
```

`copyrightLine` in `@ryusenkei/web/legal` takes a year (`© 2026 …`); use `copyright` for the company's sites.

The same values are in `@ryusenkei/company/company.json` for repositories in other languages, with the notice as `copyright` (`{ text, href }`).

No personal names and no infrastructure values (account IDs, zones) are included.

## Versioning

Versioned separately from `@ryusenkei/web`. While the version is 0.x, a minor bump may change or remove a value.

## License

MIT
