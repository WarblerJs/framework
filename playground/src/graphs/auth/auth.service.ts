import { Service, inject } from "@warbler/core";
import ApplicationLogger from "../home/application-logger";
import AuthRepository from "./auth.repository";

@Service()
export default class AuthService {
  readonly #repository = inject(AuthRepository);
  readonly #logger = inject(ApplicationLogger);

  login(username: string, password: string): Readonly<Record<string, unknown>> {
    this.#logger.log("auth.login");
    const user = this.#repository.find(username, password);
    return user === undefined
      ? Object.freeze({ authenticated: false })
      : Object.freeze({ authenticated: true, user });
  }

  profile(): Readonly<Record<string, string>> {
    return Object.freeze({ id: "user-1", username: "warbler" });
  }
}
