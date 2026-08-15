import type { UserEntity } from "../entities/user.entity";

export interface LoginUserData{
    readonly email: string;
    readonly password: string;

}
export abstract class LoginRepositoryPort {
    abstract loginUser(data:LoginUserData): Promise<UserEntity | null>;
    abstract findUserByEmail(email:string): Promise<UserEntity | null>;
}