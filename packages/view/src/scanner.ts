export class TemplateSyntaxError extends Error {
  public constructor(
    message: string,
    public readonly offset: number,
  ) {
    super(`${message} at offset ${offset}`);
    this.name = "TemplateSyntaxError";
  }
}

export class Scanner {
  private offset = 0;

  public constructor(private readonly source: string) {}

  public get position(): number {
    return this.offset;
  }

  public get done(): boolean {
    return this.offset >= this.source.length;
  }

  public peek(length = 1): string {
    return this.source.slice(this.offset, this.offset + length);
  }

  public startsWith(value: string): boolean {
    return this.source.startsWith(value, this.offset);
  }

  public advance(length = 1): void {
    this.offset += length;
  }

  public readUntil(value: string): string {
    const index = this.source.indexOf(value, this.offset);
    if (index < 0) {
      throw new TemplateSyntaxError(`Expected "${value}"`, this.offset);
    }

    const result = this.source.slice(this.offset, index);
    this.offset = index + value.length;
    return result;
  }

  public readBalanced(
    open: string,
    close: string,
  ): string {
    if (!this.startsWith(open)) {
      throw new TemplateSyntaxError(`Expected "${open}"`, this.offset);
    }

    this.advance(open.length);
    const start = this.offset;
    let depth = 1;
    let quote: "'" | '"' | "`" | null = null;
    let escaped = false;

    while (!this.done) {
      const char = this.peek();

      if (quote !== null) {
        this.advance();

        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === "\\") {
          escaped = true;
          continue;
        }

        if (char === quote) {
          quote = null;
        }

        continue;
      }

      if (char === "'" || char === '"' || char === "`") {
        quote = char;
        this.advance();
        continue;
      }

      if (this.startsWith(open)) {
        depth += 1;
        this.advance(open.length);
        continue;
      }

      if (this.startsWith(close)) {
        depth -= 1;

        if (depth === 0) {
          const value = this.source.slice(start, this.offset);
          this.advance(close.length);
          return value;
        }

        this.advance(close.length);
        continue;
      }

      this.advance();
    }

    throw new TemplateSyntaxError(`Unclosed "${open}"`, start);
  }

  public readTextUntil(
    predicates: readonly ((scanner: Scanner) => boolean)[],
  ): string {
    const start = this.offset;

    while (!this.done && !predicates.some((predicate) => predicate(this))) {
      this.advance();
    }

    return this.source.slice(start, this.offset);
  }

  public skipWhitespace(): void {
    while (!this.done && /\s/u.test(this.peek())) {
      this.advance();
    }
  }
}
