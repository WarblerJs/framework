import { Service, inject } from "@warbler/core";
import ApplicationLogger from "./application-logger";

@Service()
export default class HomeService {
  readonly #logger = inject(ApplicationLogger);

  status(): Readonly<Record<string, string>> {
    this.#logger.log("home.status");
    return Object.freeze({ framework: "Warbler", runtime: "Bun", status: "running" });
  }
}
