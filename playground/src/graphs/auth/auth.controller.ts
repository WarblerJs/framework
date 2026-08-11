import { inject } from "@warbler/core";
import { Controller, csrf, Get, JsonRes, Post, view, type AppRequest } from "@warbler/http";
import { authGuard } from "./auth.guard";
import AuthService from "./auth.service";
import { loginValidator, requestSourcesValidator, uploadAvatarValidator } from "./auth.validator";

let validationCalls = 0;

@Controller()
export default class AuthController {
  readonly #auth = inject(AuthService);

  @Get("/login")
  async getUsers(request: AppRequest): Promise<Response> {
    return view('auth.login',);
    
    //return JsonRes( await this.#auth.findAllService() );
  }

  @Post("/login", { validator: loginValidator, csrf: true })
  async login(request: AppRequest<typeof loginValidator>): Promise<Response> {
    const res = await this.#auth.login(request.body.email, request.body.password);
    return JsonRes({  email: request.body.email,});
  }

  @Post("/avatar", { validator: uploadAvatarValidator, csrf: false })
  uploadAvatar(request: AppRequest<typeof uploadAvatarValidator>): Response {
    return JsonRes({
      filename: request.body.avatar.name,
      mimeType: request.body.avatar.type,
      size: request.body.avatar.size,
    });
  }

  @Post("/validate/:id", { validator: requestSourcesValidator, csrf: false })
  validateSources(request: AppRequest<typeof requestSourcesValidator>): Response {
    validationCalls += 1;
    const retries = Number(request.headers.get("x-retries"));
    return JsonRes({
      body: request.body,
      page: request.query.page,
      id: request.params.id,
      retries: Number.isNaN(retries) ? undefined : retries,
      session: request.cookies.get("session"),
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
      requestId: request.context.requestId,
      repo:this.#auth.profile()
    });
  }
}
