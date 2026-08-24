import { Service, inject } from "@warblerjs/framework";
import { EventDispatcher } from "@warblerjs/events";
import { UserRepositoryPort } from "../../domain/ports/user.repository.port";
import { UserCreated } from "../../domain/events/user-created.event";
import type { CreateUserInput } from "../dto/create-user.input";
import { password } from "@warblerjs/crypto";
// const storedHash = await password.hash("correct horse battery staple");
// const valid = await password.verify("correct horse battery staple", storedHash);
// const shouldRehash = await password.needsRehash(storedHash);
@Service()
export class CreateUserUseCase {
  readonly #users = inject(UserRepositoryPort);
  readonly #events = inject(EventDispatcher);

  async execute(input: CreateUserInput) {
    const passwordHash = await password.hash(input.password);

    const user = await this.#users.insert({
      email: input.email,
      passwordHash,
      isActive: input.isActive,
    });
    this.#events.dispatch(UserCreated(user.id, user.email));
    return user;
  }
}
