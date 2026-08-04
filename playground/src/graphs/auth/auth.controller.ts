import { inject } from "@warbler/core";
import { Controller, Get, JsonRes, Post, type AppRequest } from "@warbler/http";
import { authGuard } from "./auth.guard";
import AuthService from "./auth.service";
import { type LoginInput, loginValidator } from "./auth.validator";

@Controller()
export default class AuthController {
  readonly #auth = inject(AuthService);

  @Post("/login", { validator: loginValidator, csrf: false })
  login(request: AppRequest<LoginInput>): Response {
    return JsonRes(this.#auth.login(request.body.username, request.body.password));
  }

  @Get("/profile/:id", { guards: [authGuard] })
  profile(request: AppRequest): Response {
    console.log('>>>>Bism Allah.',request.params.id)
    console.log('>>>>Arrahman Arrahim.');
    console.log('----');
    return JsonRes({
      tr: request.tr('welcome',{name:'habib'}) ,
      repo:this.#auth.profile()
    });
  }
}
