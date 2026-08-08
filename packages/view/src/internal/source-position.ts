/** 1-indexed line/column position, used only for development-mode error formatting. */
export interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

/** Converts a character offset into a 1-indexed line/column pair for a template source string. */
export function offsetToLineColumn(source: string, offset: number): SourcePosition {
  const bounded = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let lastNewline = -1;

  for (let index = 0; index < bounded; index += 1) {
    if (source.charCodeAt(index) === 10) {
      line += 1;
      lastNewline = index;
    }
  }

  return Object.freeze({ line, column: bounded - lastNewline });
}
