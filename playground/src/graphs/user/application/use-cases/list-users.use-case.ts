import { ConflictError, Service, inject } from "@warbler/core";
import { UserRepositoryPort } from "../../domain/ports/user.repository.port";
import { AppErrorCode } from "@errors/app-error-code";

@Service()
export class ListUsersUseCase {
  readonly #users = inject(UserRepositoryPort);

  execute(limit = 100, offset = 0) {
    // throw new ConflictError(AppErrorCode.USER_NOT_FOUND, `Limit not stable values`);
    return this.#users.findMany({
      limit,
      offset,
    });
  }
}
