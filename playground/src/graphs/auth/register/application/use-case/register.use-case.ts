import { inject, left, NotFoundError, right, Service, type Either } from "@warbler/core";
import { RegisterRepositoryPort, type CreateUserData } from "../../domain/ports/register.repository.port";
import { AppErrorCode } from "@errors/app-error-code";
import type { UserEntity } from "../../domain/entities/user.entity";
import { EventDispatcher } from "@warbler/events";
import { UserCreated } from "../../domain/events/user-created.event";

@Service()
export class RegisterUseCase {
    readonly #register = inject(RegisterRepositoryPort);
    readonly #events = inject(EventDispatcher);

    async execute(data: CreateUserData): Promise<Either<AppErrorCode, UserEntity>> {
        const emailExist = await this.#register.emailExist(data.email);
        this.#events.dispatch(UserCreated('1', data.email));

        if (emailExist) {
            return left(AppErrorCode.EMAIL_EXIST);
        } else {
            return right(await this.#register.createNewUser(data));
        }
    }
}