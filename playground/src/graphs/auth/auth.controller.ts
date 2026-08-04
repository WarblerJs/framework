import { inject } from "@warbler/core";
import { Controller, Get, JsonRes, Post } from "@warbler/http";
import { authGuard } from "./auth.guard";
import AuthService from "./auth.service";
import { type LoginInput, loginValidator } from "./auth.validator";

@Controller()
export default class AuthController {
  readonly #auth = inject(AuthService);

  @Post("/login", { validator: loginValidator, csrf: true })
  login(input: LoginInput): Response {
    return JsonRes(this.#auth.login(input.username, input.password));
  }

  @Get("/profile", { guards: [authGuard] })
  profile(): Response {
    return JsonRes(this.#auth.profile());
  }
}
