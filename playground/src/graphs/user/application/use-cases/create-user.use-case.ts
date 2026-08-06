import { Service, inject } from "@warbler/core";
import { UserRepositoryPort } from "../../domain/ports/user.repository.port";
import type { CreateUserInput } from "../dto/create-user.input";

@Service()
export class CreateUserUseCase {
  readonly #users = inject(UserRepositoryPort);

  async execute(input: CreateUserInput) {
    const passwordHash = await Bun.password.hash(input.password);

    return this.#users.insert({
      email: input.email,
      passwordHash,
      isActive: input.isActive,
    });
  }
}
