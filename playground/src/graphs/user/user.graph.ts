import { Graph } from "@warbler/core";
import { UserController } from "./presentation/http/user.controller";
import { CreateUserUseCase } from "./application/use-cases/create-user.use-case";
import { FindUserUseCase } from "./application/use-cases/find-user.use-case";
import { ListUsersUseCase } from "./application/use-cases/list-users.use-case";
import { WlbPgUserRepository } from "./infrastructure/persistence/wlb-pg-user.repository";

@Graph({
  prefix: "/users",
  controllers: [
    UserController,
  ],
  providers: [
    WlbPgUserRepository,
    CreateUserUseCase,
    FindUserUseCase,
    ListUsersUseCase,
  ],
})
export class UserGraph {}
