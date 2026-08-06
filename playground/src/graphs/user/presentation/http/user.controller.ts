import { inject } from "@warbler/core";
import { Controller, Get, JsonRes, Post } from "@warbler/http";
import { CreateUserUseCase } from "../../application/use-cases/create-user.use-case";
import { FindUserUseCase } from "../../application/use-cases/find-user.use-case";
import { ListUsersUseCase } from "../../application/use-cases/list-users.use-case";
import type { CreateUserRequest } from "./user.validator";

@Controller()
export class UserController {
  readonly #createUser = inject(CreateUserUseCase);
  readonly #findUser = inject(FindUserUseCase);
  readonly #listUsers = inject(ListUsersUseCase);

  @Get("/")
  async list() {
    return JsonRes( await this.#listUsers.execute(100, 0));
  }

  @Get("/:id")
  find(request: Request) {
    const url = new URL(request.url);
    const id = url.pathname.split("/").at(-1);

    if (!id) {
      return new Response("Missing user id", {
        status: 400,
      });
    }

    return this.#findUser.execute(id);
  }

  @Post("/")
  create(input: CreateUserRequest) {
    return this.#createUser.execute(input);
  }
}
