import { inject, left, right, Service, type Either } from "@warbler/core";
import { LoginRepositoryPort } from "../../domain/ports/login.repository.port";
import { password } from "@warbler/crypto";
import type { LoginResult } from "../dto/login-result";
import type { FindUserParams } from "../../domain/repositories/find-user.params";
import type { LoginTranslationKey } from "../types/login-translation-key";

@Service()
export class LoginUseCase {
    readonly #repository = inject(LoginRepositoryPort);
    //readonly #events = inject(EventDispatcher);

    async execute(data: FindUserParams): Promise<Either<LoginTranslationKey, LoginResult>> {
        const user = await this.#repository.findUserByEmail(data.email);
        
        if (!user) {
            return left('emailOrPassNotCorrect');
        } 
            const isPasswordCorrect = await password.verify(data.password,user.passwordHash);
            
            if(! isPasswordCorrect ) {
                return left('emailOrPassNotCorrect');
            }

           const sessionId = crypto.randomUUID();
          
            return right({ user,sessionId});
        
    }
}