import type { Problem } from '@ryusenkei/core';
import type { FieldErrorCode } from './index.ts';
import type { SubmissionErrorCode } from './client.ts';

/** 標準の文言を持つコード（項目の検査、フォームの選択の誤り、受け取りの処理の結果、通信の失敗） */
export type FormMessageCode = FieldErrorCode | 'unknown_form' | SubmissionErrorCode | 'network';

/** 標準の文言（日本語）。`{max}` などは `params` の値に置き換える */
export const FORM_MESSAGES_JA: Readonly<Record<FormMessageCode, string>> = {
  required: '入力してください',
  too_long: '{max}文字以内で入力してください',
  too_short: '{min}文字以上で入力してください',
  invalid_email: 'メールアドレスの形式で入力してください',
  invalid_url: 'http:// か https:// で始まる URL を入力してください',
  url_host: 'この URL は受け付けていません',
  invalid_choice: '選択肢から選んでください',
  too_many: '{max}個まで選んでください',
  too_few: '{min}個以上選んでください',
  unknown_form: 'ページを読み込み直してから送信してください',
  invalid: '入力の内容を確かめてください',
  too_large: '送信の内容が大きすぎます',
  rate_limited: '送信が続いています。しばらく待ってから送信してください',
  bot_check_failed: '確認に失敗しました。ページを読み込み直してから送信してください',
  unauthenticated: 'ログインの確認ができませんでした。ページを開き直してから送信してください',
  already_submitted: 'すでに回答を受け付けています',
  quota_exceeded: '本日の受付は終了しました。明日以降に送信してください',
  forbidden_origin: 'このページからは送信できません',
  unavailable: '一時的に送信できません。時間をおいて送信してください',
  not_configured: '送信の設定が終わっていないため、受け付けられません',
  internal: '送信できませんでした。時間をおいて送信してください',
  method_not_allowed: '送信の方法が正しくありません',
  network: '通信に失敗しました。接続を確かめてから送信してください',
};

/** 文言の上書き（製品ごとの言い回し、`refine` の独自のコード） */
export type FormMessages = Readonly<Partial<Record<string, string>>>;

export type FormMessageOptions = Readonly<{
  /** 文言に差し込む値（`{max}` など） */
  params?: Problem['params'];
  /** 文言の上書き */
  messages?: FormMessages;
}>;

/**
 * コードの文言。上書き、標準の文言の順に引き、どちらにもなければコードを返す
 * - `{name}` は `params` の同じ名前の値に置き換える
 */
export function formMessage(code: string, options: FormMessageOptions = {}): string {
  const { params = {}, messages = {} } = options;
  const template = messages[code] ?? (FORM_MESSAGES_JA as Readonly<Record<string, string>>)[code] ?? code;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (Object.hasOwn(params, key) ? String(params[key]) : whole));
}

/** 検査の問題の文言 */
export const problemMessage = (problem: Problem, options: Readonly<{ messages?: FormMessages }> = {}): string => formMessage(problem.code, { ...(problem.params && { params: problem.params }), ...(options.messages && { messages: options.messages }) });
