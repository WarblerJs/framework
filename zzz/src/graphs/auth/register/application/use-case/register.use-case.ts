import { inject, NotFoundError, Service } from "@warbler/core";
import { RegisterRepositoryPort, type CreateUserData } from "../../domain/ports/register.repository.port";
import { AppErrorCode } from "@errors/app-error-code";
import type { UserEntity } from "../../domain/entities/user.entity";

@Service()
export class RegisterUseCase {
    readonly #register = inject(RegisterRepositoryPort)

    async execute(data: CreateUserData): Promise<UserEntity | {}> {
        const emailExist = await this.#register.emailExist(data.email);

        if (emailExist) {
            return {
                success: false,
                code: AppErrorCode.EMAIL_EXIST,
            };
        } else {
            return await this.#register.createNewUser(data);
        }
    }
}