import { ProviderScope, Service } from "@warbler/core";

@Service({ provide: ProviderScope.ROOT })
export default class ApplicationLogger {
  readonly #entries: string[] = [];

  log(stage: string): void {
    this.#entries.push(stage);
  }

  entries(): readonly string[] {
    return Object.freeze([...this.#entries]);
  }
}
