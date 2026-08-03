/** Immutable request representation passed to Warbler controller handlers. */
export interface AppRequest<
  TBody = unknown,
  TParams extends Record<string, string> = Record<string, string>,
  TQuery = Readonly<Record<string, string | readonly string[]>>,
  TContext = unknown,
> {
  readonly native: Request;
  readonly body: TBody;
  readonly params: Readonly<TParams>;
  readonly query: TQuery;
  readonly headers: Headers;
  readonly cookies: Readonly<Record<string, string>>;
  readonly context: TContext;
}
