/** 段落の部品（文字列と、メールアドレス・URL のリンク） */
export type Inline = string | Readonly<{ email: string }> | Readonly<{ url: string; text: string }>;

/** 段落（文字列か、部品の列） */
export type Paragraph = string | readonly Inline[];

/** 表の行（運営者の表など） */
export type Row = Readonly<{ label: string; value: Paragraph }>;

/**
 * 条。番号の付け方と記号は描画の側が決める
 * - `items`: 番号付きの列挙、`bullets`: 番号なしの列挙、`after`: 列挙の後の段落
 */
export type Article = Readonly<{
  title: string;
  paragraphs: readonly Paragraph[];
  items?: readonly Paragraph[];
  bullets?: readonly Paragraph[];
  after?: readonly Paragraph[];
  table?: readonly Row[];
}>;

export type Revision = Readonly<{ date: string; note?: string }>;

/**
 * 組み立てた文書（見た目は持たない）
 * - `missing`: 下書きの間に未定のままの項目（制定の前に埋める）
 */
export type LegalDocument = Readonly<{
  title: string;
  intro: readonly Paragraph[];
  articles: readonly Article[];
  enactedOn: string | null;
  revisedOn: string | undefined;
  revisions: readonly Revision[];
  missing: readonly string[];
}>;

/** 宣言の誤り（制定したのに未定の項目がある、特商法で省略できない項目を省略した、など） */
export class LegalDeclarationError extends Error {
  override readonly name = 'LegalDeclarationError';
  readonly problems: readonly string[];
  constructor(message: string, problems: readonly string[]) {
    super(`${message}: ${problems.join('、')}`);
    this.problems = problems;
  }
}
