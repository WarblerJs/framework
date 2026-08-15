import { inject, left, right, Service, type Either } from "@warbler/core";
import { LoginRepositoryPort, type LoginUserData } from "../../domain/ports/login.repository.port";
import { password } from "@warbler/crypto";
import type { LoginResult } from "../dto/login-result";

@Service()
export class LoginUseCase {
    readonly #register = inject(LoginRepositoryPort);
    //readonly #events = inject(EventDispatcher);

    async execute(data: LoginUserData): Promise<Either<string, LoginResult>> {
        const user = await this.#register.findUserByEmail(data.email);
        
        if (!user) {
            return left('emailOrPassNotCorrect');
        } else {
            const isPasswordCorrect = await password.verify(data.password,user.passwordHash);
            if(! isPasswordCorrect ) {
                return left('emailOrPassNotCorrect');
            }
           const sessionId = crypto.randomUUID();
          
            return right({ user,sessionId});
        }
    }
}