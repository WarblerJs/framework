import { Service, inject } from "@warbler/core";
import { UserRepositoryPort } from "../../domain/ports/user.repository.port";

@Service()
export class ListUsersUseCase {
  readonly #users = inject(UserRepositoryPort);

  execute(limit = 100, offset = 0) {
    return this.#users.findMany({
      limit,
      offset,
    });
  }
}
