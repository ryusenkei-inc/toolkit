#!/usr/bin/env node
// Search Console の所有権の確認と sitemap の送信
//   ryusenkei-search-console token <ドメイン>             TXT の値を表示（DNS には Terraform で入れる）
//   ryusenkei-search-console verify <ドメイン>            TXT で所有権を確認し、ドメインのプロパティを足す
//   ryusenkei-search-console submit <サイト> <sitemap の URL>  sitemap を送る（サイトは sc-domain:example.com か URL）
//   ryusenkei-search-console sitemaps <サイト>            送った sitemap の状態
// - 認証: GOOGLE_APPLICATION_CREDENTIALS（サービスアカウントの鍵のファイル）、なければ gcloud のログイン（ADC）
// - 終了の状態: 成功は0、API の失敗は1、使い方の誤りは2（`--help` は0）

const [command, a, b] = process.argv.slice(2);
const usage = 'usage: ryusenkei-search-console token|verify <ドメイン> / submit <サイト> <sitemap の URL> / sitemaps <サイト>';
const valid = (command === 'token' || command === 'verify' || command === 'sitemaps') && a ? true : command === 'submit' && a && b;

if (command === '--help' || command === '-h') {
  console.log(usage);
  process.exit(0);
}
if (!valid) {
  console.error(usage);
  process.exit(2);
}

// 使い方の判定の後に読み込む（`--help` と使い方の誤りは API の準備なしで答える）
const { addSite, domainProperty, GOOGLE_SCOPES, googleAccessToken, listSitemaps, siteVerificationToken, submitSitemap, verifyDomain } = await import('./google.ts');
const options = { accessToken: googleAccessToken([GOOGLE_SCOPES.webmasters, GOOGLE_SCOPES.siteVerification]) };

try {
  if (command === 'token') {
    console.log(await siteVerificationToken(a!, options));
  } else if (command === 'verify') {
    await verifyDomain(a!, options);
    await addSite(domainProperty(a!), options);
    console.log(`確認済み、プロパティ ${domainProperty(a!)} を追加`);
  } else if (command === 'submit') {
    await submitSitemap(a!, b!, options);
    console.log(`送信: ${b}`);
  } else {
    for (const s of await listSitemaps(a!, options)) console.log(`${s.path}  送信 ${s.lastSubmitted ?? '-'}  取得 ${s.lastDownloaded ?? '-'}  エラー ${s.errors ?? 0}  警告 ${s.warnings ?? 0}${s.isPending ? '  処理中' : ''}`);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
