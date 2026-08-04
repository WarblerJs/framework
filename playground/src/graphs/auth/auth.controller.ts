import { inject } from "@warbler/core";
import { Controller, Get, JsonRes, Post, type AppRequest } from "@warbler/http";
import { authGuard } from "./auth.guard";
import AuthService from "./auth.service";
import {
  type LoginInput,
  type UploadAvatarInput,
  loginValidator,
  uploadAvatarValidator,
} from "./auth.validator";

@Controller()
export default class AuthController {
  readonly #auth = inject(AuthService);

  @Post("/login", { validator: loginValidator, csrf: false })
  login(request: AppRequest<LoginInput>): Response {
    return JsonRes({
      name: request.body.name,
      d: this.#auth.login(request.body.name, request.body.password)
    });
  }

  @Post("/avatar", { validator: uploadAvatarValidator, csrf: false })
  uploadAvatar(request: AppRequest<UploadAvatarInput>): Response {
    return JsonRes({
      filename: request.body.avatar.name,
      mimeType: request.body.avatar.type,
      size: request.body.avatar.size,
    });
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
