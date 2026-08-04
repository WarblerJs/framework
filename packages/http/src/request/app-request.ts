import type { TranslationParameters } from "@warbler/i18n";

/** Immutable request representation passed to Warbler controller handlers. */
export interface AppRequest<
  TBody = unknown,
  TParams extends Record<string, unknown> = Record<string, string>,
  TQuery = Readonly<Record<string, string | readonly string[]>>,
  TContext = unknown,
  THeaders = Headers,
  TCookies = Readonly<Record<string, string>>,
> {
  readonly native: Request;
  readonly body: TBody;
  readonly params: Readonly<TParams>;
  readonly query: TQuery;
  readonly headers: THeaders;
  readonly cookies: TCookies;
  readonly context: TContext;
  readonly locale: string;
  tr(key: string, parameters?: TranslationParameters): string;
}
