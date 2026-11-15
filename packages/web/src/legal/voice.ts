// 文書の主語と対象の呼び方（プライバシーポリシーと広告の掲載についての表示で共通）
import { LegalDeclarationError } from './document.ts';

export type VoiceDeclaration = Readonly<{ subject: string; subjectShort?: string; speaker?: string }>;

/**
 * 主語と呼び方
 * - `op`: 運営者としての主語（既定は「当社」）
 * - `actor`: サイトとしての主語（既定は対象の呼び方。主語を指定すれば主語）
 * - `site`: 対象の呼び方（既定は「当サイト」。主語が「当サイト」なら「本サイト」）
 * - `intro(rest)`: 前文の書き出し。主語を指定すれば、主語を運営者として定義する
 */
export function voiceOf(d: VoiceDeclaration) {
  const site = d.subjectShort ?? (d.speaker === '当サイト' ? '本サイト' : '当サイト');
  if (d.speaker === site) throw new LegalDeclarationError('主語と対象の呼び方が同じ', ['speaker', 'subjectShort']);
  const speaker = d.speaker;
  return {
    site,
    op: speaker ?? '当社',
    actor: speaker ?? site,
    intro: (rest: string) => (speaker ? `${d.subject}（以下「${site}」といいます。）の運営者（以下「${speaker}」といいます。）は、${site}${rest}` : `当社は、${d.subject}（以下「${site}」といいます。）${rest}`),
  };
}
