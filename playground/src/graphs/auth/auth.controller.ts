import { inject } from "@warbler/core";
import { Controller, Get, JsonRes, Post, type AppRequest } from "@warbler/http";
import { authGuard } from "./auth.guard";
import AuthService from "./auth.service";
import {
  type LoginInput,
  type RequestSourcesBody,
  type UploadAvatarInput,
  loginValidator,
  requestSourcesValidator,
  uploadAvatarValidator,
} from "./auth.validator";

type SourcesRequest = AppRequest<
  RequestSourcesBody,
  { readonly id: number },
  { readonly page: number; readonly type: string },
  unknown,
  { readonly "x-retries": number },
  { readonly session: string }
>;
let validationCalls = 0;

@Controller()
export default class AuthController {
  readonly #auth = inject(AuthService);

  @Get("/login", {  })
  async getUsers(request: AppRequest): Promise<Response> {
    return JsonRes( await this.#auth.findAllService() );
  }

  @Post("/login", { validator: loginValidator, csrf: false })
  async login(request: AppRequest<LoginInput>): Promise<Response> {
    return JsonRes({
      email: request.body.email,
      d: await this.#auth.login(request.body.email, request.body.password)
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

  @Post("/validate/:id", { validator: requestSourcesValidator, csrf: false })
  validateSources(request: SourcesRequest): Response {
    validationCalls += 1;
    return JsonRes({
      body: request.body,
      page: request.query.page,
      id: request.params.id,
      retries: request.headers["x-retries"],
      session: request.cookies.session,
      calls: validationCalls,
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
