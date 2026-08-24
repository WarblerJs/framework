import { NotFoundError, Service, inject } from "@warblerjs/framework";
import { AppErrorCode } from "../../../../shared/errors/app-error-code";
import { UserRepositoryPort } from "../../domain/ports/user.repository.port";

@Service()
export class FindUserUseCase {
  readonly #users = inject(UserRepositoryPort);

  async execute(id: string) {
    const user = await this.#users.findById(id);
    if (!user) {
      throw new NotFoundError(AppErrorCode.USER_NOT_FOUND, "User not found");
    }
    return user;
  }
}
