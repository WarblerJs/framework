import { Repository } from "@warbler/core";
import { WlbPg } from "../../../../../database/warbler/pg/generated/client";
import type { User } from "../../domain/entities/user.entity";
import {
  UserRepositoryPort,
  type CreateUserData,
  type FindManyUsersOptions,
} from "../../domain/ports/user.repository.port";

@Repository({
  provide: UserRepositoryPort,
})
export class WlbPgUserRepository extends UserRepositoryPort {
  insert(data: CreateUserData): Promise<User> {
    return WlbPg.user.insert(data);
  }

  findById(id: string): Promise<User | null> {
    return WlbPg.user.findUnique({ id });
  }

  findByEmail(email: string): Promise<User | null> {
    return WlbPg.user.findUnique({ email });
  }

  findMany(
    options: FindManyUsersOptions = {},
  ): Promise<readonly User[]> {
    return WlbPg.user.findMany({
      limit: options.limit ?? 100,
      offset: options.offset ?? 0,
    });
  }
}
