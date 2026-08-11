import { Service, inject } from "@warbler/core";
import ApplicationLogger from "../home/application-logger";
import AuthRepository from "./auth.repository";
import type { UserRow } from "@pg/client/user";
import { password } from "@warbler/crypto";
// import type { UserRow } from "../../../database/warbler/pg/generated/client/user";
//import type { UserRow } from "@pg/client/user";

@Service()
export default class AuthService {
  readonly #repository = inject(AuthRepository);
  readonly #logger = inject(ApplicationLogger);

  async login(email: string, password: string): Promise<Readonly<Record<string, unknown>>> {
    this.#logger.log("auth.login");
    const user = await this.#repository.find(email);
    user?.passwordHash && console.log('user',password.match(user.passwordHash))
    return user === undefined
      ? Object.freeze({ authenticated: false })
      : Object.freeze({ authenticated: true, user });
  }

  profile(): Readonly<Record<string, string>> {
    return Object.freeze({ id: "user-1", username: "warbler" });
  }

  async findAllService(): Promise<UserRow[] | undefined> {
    return await this.#repository.finAll();
  }
}
