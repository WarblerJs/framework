import { inject } from "@warbler/core";
import { Controller, Get, JsonRes, Post, type AppRequest, view, csrf } from "@warbler/http";
import { AppErrorCode } from "../../../../shared/errors/app-error-code";
import { CreateUserUseCase } from "../../application/use-cases/create-user.use-case";
import { FindUserUseCase } from "../../application/use-cases/find-user.use-case";
import { ListUsersUseCase } from "../../application/use-cases/list-users.use-case";

import { valiateUserID } from "../validators/valiate_user_id.validator";
import { userPermissionGuard } from "../guards/user-permission.guard";
import { postUserValidatore } from "../validators/post_user.validator";
import { Email } from "@warbler/email";
import { auditMiddleware, authMiddleware } from "../../../../shared/middlewares/scope.middleware";

@Controller({
  middleware: [
    authMiddleware,
  ],
})
export class UserController {
  readonly #createUser = inject(CreateUserUseCase);
  readonly #findUser = inject(FindUserUseCase);
  readonly #listUsers = inject(ListUsersUseCase);
  readonly #appEmail = inject(Email);

  @Get("/")
  async list() {

    return JsonRes({
      crsf: csrf().token ,
      users: await this.#listUsers.execute(10, 0)
    });
  }

  @Get("/:id", {
    name: "users.show",
    validator: valiateUserID,
    guards: [userPermissionGuard],

  })
  async find(request: AppRequest<typeof valiateUserID>) {

    return JsonRes({
      ctx: request.context.requestId,
      user: await this.#findUser.execute(request.params.id + '')
    });
  }
  @Get("/add",)
  async add(request: AppRequest) {

    return view('user.add-form', {
      title: 'Add new user'
    });
  }

  @Post("/", {
    name: "users.create",
    csrf: true,
    validator: postUserValidatore
  })
  async create(request: AppRequest<typeof postUserValidatore>) {
    //const res = await this.#createUser.execute(request.body);
    await this.#appEmail.send({
      from: 'alarazigh@gmail.com',
      to: "bellib6@gmail.com",
      subject: "Welcome warbler",
     // text: "Welcome to Warbler. Your account is ready: bellib6@gmail.com. User id: playground.",
      template: "mail.welcome",
      data: { email: "bellib6@gmail.com", userId: "playground" },
    })

    return JsonRes({  })
  }

  @Get("/middleware/inherited")
  middlewareInherited(request: AppRequest) {
    return JsonRes({
      requestId: request.context.requestId,
      tenant: request.context.tenant,
      user: request.context.user,
      audit: request.context.audit,
    });
  }

  @Get("/middleware/all", {
    middleware: [
      auditMiddleware,
    ],
  })
  middlewareAll(request: AppRequest) {
    return JsonRes({
      requestId: request.context.requestId,
      tenant: request.context.tenant,
      user: request.context.user,
      audit: request.context.audit,
    });
  }
}
