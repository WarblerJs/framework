import { inject, left, right, Service, type Either } from "@warblerjs/framework";
import type { AuthTranslationKey } from "src/graphs/auth/application/types/auth-translation-key";
import { FindUserRepositoryPort } from "../../domain/ports/user.repository.port";


@Service()
export class GetUserUseCase {
     readonly #repository = inject(FindUserRepositoryPort);
    // readonly #sessions = inject(SessionRepositoryPort);

    async execute(id:number): Promise<Either<AuthTranslationKey, {user:any,sessionId:string}>> {
        
        if (id > 4 ) {
            return right({
                user: { habib:'bel from excute'},
                sessionId: 'rpepee from excute',
                usersList: await this.#repository.findUsers()
            }); 
        } else {
            return left('emailOrPassNotCorrect');
        }

    }
}
