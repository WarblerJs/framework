import type { UserEntity } from "../entities/user.entity";
import type { FindUserParams } from "../repositories/find-user.params";


export abstract class LoginRepositoryPort {
    abstract loginUser( params: FindUserParams): Promise<UserEntity | null>;
    abstract findUserByEmail(email:string): Promise<UserEntity | null>;
}