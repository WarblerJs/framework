import type { UserEntity } from "../entities/user.entity";

export interface CreateUserData {
    readonly email: string;
    readonly password: string;
    readonly isActive?: boolean;
}

export abstract class AuthRepositoryPort {
    abstract findUserByEmail(email: string): Promise<UserEntity | null>;
    abstract createUser(data: CreateUserData): Promise<UserEntity>;
}
