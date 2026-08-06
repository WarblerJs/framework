import type { User } from "../entities/user.entity";

export interface CreateUserData {
  readonly email: string;
  readonly passwordHash: string;
  readonly isActive?: boolean;
}

export interface FindManyUsersOptions {
  readonly limit?: number;
  readonly offset?: number;
}

export abstract class UserRepositoryPort {
  abstract insert(data: CreateUserData): Promise<User>;

  abstract findById(id: string): Promise<User | null>;

  abstract findByEmail(email: string): Promise<User | null>;

  abstract findMany(
    options?: FindManyUsersOptions,
  ): Promise<readonly User[]>;
}
