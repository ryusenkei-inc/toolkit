// 会社の値を JSON でも出す（Go や Rust のリポから読むため）。ビルドの後に dist の JS から作る
import { writeFileSync } from 'node:fs';

const company = await import(new URL('../dist/index.js', import.meta.url).href);
const { CONTACT_EMAIL, operator, retention, services, contact, copyright } = company;
const { text, href } = copyright();
writeFileSync(new URL('../dist/company.json', import.meta.url), `${JSON.stringify({ contactEmail: CONTACT_EMAIL, operator, retention, services, contact, copyright: { text, href } }, null, 2)}\n`);
