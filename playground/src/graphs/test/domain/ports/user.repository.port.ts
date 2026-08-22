import type { UserEntity } from "../entities/user.entity";

export abstract class FindUserRepositoryPort {
    abstract findUsers(): Promise<readonly UserEntity[]>;
}