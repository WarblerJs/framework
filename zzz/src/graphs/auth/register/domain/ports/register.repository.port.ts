import type { UserEntity } from "../entities/user.entity";

export interface CreateUserData{
    readonly email: string;
    readonly password: string;
    readonly isActive?: boolean

}
export abstract class RegisterRepositoryPort {
    abstract createNewUser(data:CreateUserData): Promise<UserEntity>;
    abstract emailExist(email:string): Promise<UserEntity | null>;
}