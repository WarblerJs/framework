/** Compact compiler-produced HTTP route record. */
export interface CompiledHttpRouteRecord {
  readonly methodStringId: number;
  readonly pathStringId: number;
  readonly controllerStringId: number;
  readonly handlerStringId: number;
  readonly controllerId: number;
  readonly handlerId: number;
  readonly flags: number;
  readonly csrfPolicyId: number;
  readonly validationPolicyId: number;
  readonly middlewareStart: number;
  readonly middlewareCount: number;
}

/** Compiler-produced HTTP route table and deduplicated string storage. */
export interface CompiledHttpRouteTable {
  readonly strings: readonly string[];
  readonly routes: readonly CompiledHttpRouteRecord[];
}

/** Deterministic amortized-constant-time string interner for compiler integrations. */
export class StringTableBuilder {
  readonly #ids = new Map<string, number>();
  readonly #values: string[] = [];

  /** Returns the stable ID for a string, inserting it only once. */
  public intern(value: string): number {
    const existing = this.#ids.get(value);
    if (existing !== undefined) return existing;
    const id = this.#values.length;
    this.#values.push(value);
    this.#ids.set(value, id);
    return id;
  }

  /** Returns a frozen snapshot without exposing mutable builder storage. */
  public build(): readonly string[] {
    return Object.freeze(this.#values.slice());
  }
}
