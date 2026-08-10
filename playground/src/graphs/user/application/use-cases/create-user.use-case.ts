import { Service, inject } from "@warbler/core";
import { UserRepositoryPort } from "../../domain/ports/user.repository.port";
import type { CreateUserInput } from "../dto/create-user.input";
import { password } from "@warbler/crypto";
// const storedHash = await password.hash("correct horse battery staple");
// const valid = await password.verify("correct horse battery staple", storedHash);
// const shouldRehash = await password.needsRehash(storedHash);
@Service()
export class CreateUserUseCase {
  readonly #users = inject(UserRepositoryPort);

  async execute(input: CreateUserInput) {
    const passwordHash = await password.hash(input.password);

    return this.#users.insert({
      email: input.email,
      passwordHash,
      isActive: input.isActive,
    });
  }
}
