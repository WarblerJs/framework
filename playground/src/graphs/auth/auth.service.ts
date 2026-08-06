import { Service, inject } from "@warbler/core";
import ApplicationLogger from "../home/application-logger";
import AuthRepository from "./auth.repository";

@Service()
export default class AuthService {
  readonly #repository = inject(AuthRepository);
  readonly #logger = inject(ApplicationLogger);

  async login(email: string, password: string): Promise<Readonly<Record<string, unknown>>> {
    this.#logger.log("auth.login");
    const user = await this.#repository.find(email, password);
    return user === undefined
      ? Object.freeze({ authenticated: false })
      : Object.freeze({ authenticated: true, user });
  }

  profile(): Readonly<Record<string, string>> {
    return Object.freeze({ id: "user-1", username: "warbler" });
  }
}
