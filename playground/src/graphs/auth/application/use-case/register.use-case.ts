import { inject, left, right, Service, type Either } from "@warbler/core";
import { EventDispatcher } from "@warbler/events";
import type { UserEntity } from "../../domain/entities/user.entity";
import { UserCreated } from "../../domain/events/user-created.event";
import { AuthRepositoryPort, type CreateUserData } from "../../domain/ports/auth.repository.port";
import type { AuthTranslationKey } from "../types/auth-translation-key";

@Service()
export class RegisterUseCase {
    readonly #repository = inject(AuthRepositoryPort);
    readonly #events = inject(EventDispatcher);

    async execute(data: CreateUserData): Promise<Either<AuthTranslationKey, UserEntity>> {
        const existingUser = await this.#repository.findUserByEmail(data.email);

        if (existingUser) {
            return left("emailExist");
        }

        const newUser = await this.#repository.createUser(data);
        this.#events.dispatch(UserCreated(newUser.id, data.email));

        return right(newUser);
    }
}
