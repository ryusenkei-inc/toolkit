#!/usr/bin/env node
// Search Console の所有権の確認と sitemap の送信
//   ryusenkei-search-console token <ドメイン>             TXT の値を表示（DNS には Terraform で入れる）
//   ryusenkei-search-console verify <ドメイン>            TXT で所有権を確認し、ドメインのプロパティを足す
//   ryusenkei-search-console submit <サイト> <sitemap の URL>  sitemap を送る（サイトは sc-domain:example.com か URL）
//   ryusenkei-search-console sitemaps <サイト>            送った sitemap の状態
// - 認証: GOOGLE_APPLICATION_CREDENTIALS（サービスアカウントの鍵のファイル）、なければ gcloud のログイン（ADC）
import { addSite, domainProperty, GOOGLE_SCOPES, googleAccessToken, listSitemaps, siteVerificationToken, submitSitemap, verifyDomain } from './google.ts';

const [command, a, b] = process.argv.slice(2);
const options = { accessToken: googleAccessToken([GOOGLE_SCOPES.webmasters, GOOGLE_SCOPES.siteVerification]) };
const usage = 'ryusenkei-search-console token|verify <ドメイン> / submit <サイト> <sitemap の URL> / sitemaps <サイト>';

try {
  if (command === 'token' && a) {
    console.log(await siteVerificationToken(a, options));
  } else if (command === 'verify' && a) {
    await verifyDomain(a, options);
    await addSite(domainProperty(a), options);
    console.log(`確認済み、プロパティ ${domainProperty(a)} を追加`);
  } else if (command === 'submit' && a && b) {
    await submitSitemap(a, b, options);
    console.log(`送信: ${b}`);
  } else if (command === 'sitemaps' && a) {
    for (const s of await listSitemaps(a, options)) console.log(`${s.path}  送信 ${s.lastSubmitted ?? '-'}  取得 ${s.lastDownloaded ?? '-'}  エラー ${s.errors ?? 0}  警告 ${s.warnings ?? 0}${s.isPending ? '  処理中' : ''}`);
  } else {
    console.error(usage);
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
