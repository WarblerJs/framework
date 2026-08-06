import { Service, inject } from "@warbler/core";
import { UserRepositoryPort } from "../../domain/ports/user.repository.port";

@Service()
export class FindUserUseCase {
  readonly #users = inject(UserRepositoryPort);

  execute(id: string) {
    return this.#users.findById(id);
  }
}
