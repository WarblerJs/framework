import { inject } from "@warbler/core";
import { Controller, Get, JsonRes, Post, type AppRequest } from "@warbler/http";
import { CreateUserUseCase } from "../../application/use-cases/create-user.use-case";
import { FindUserUseCase } from "../../application/use-cases/find-user.use-case";
import { ListUsersUseCase } from "../../application/use-cases/list-users.use-case";

import { valiateUserID } from "../validators/valiate_user_id.validator";

@Controller()
export class UserController {
  readonly #createUser = inject(CreateUserUseCase);
  readonly #findUser = inject(FindUserUseCase);
  readonly #listUsers = inject(ListUsersUseCase);

  @Get("/")
  async list() {
    return JsonRes( await this.#listUsers.execute(10, 0));
  }

  @Get("/:id",{
    validator: valiateUserID,
    
  })
  async find(request: AppRequest<typeof valiateUserID>) {
    
    if (!request.params.id) {
      return new Response("Missing user id", {
        status: 400,
      });
    }

    return JsonRes( await this.#findUser.execute(request.params.id + ''));
  }

  // @Post("/")
  // create(input: any) {
  //   return this.#createUser.execute(input);
  // }
}
