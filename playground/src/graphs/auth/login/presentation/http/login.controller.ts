import { Controller, Get, JsonRes, Post, view, type AppRequest } from "@warbler/http";
import { LoginUseCase,  } from "../../application/use-case/login.use-case";
import { WlbPgLoginRepository } from "../../infrastructure/persistance/wlb-pg-user.repository";
import { inject } from "@warbler/core";
import { loginValidators } from "../validators/login.validator";
import type { LoginResult } from "../../application/dto/login-result";
import type { LoginTranslationKey } from "../../application/types/login-translation-key";

@Controller({
    prefix: '/login',
    providers: [
        LoginUseCase,
        WlbPgLoginRepository
    ]
})
export class LoginController {

    readonly #loginUser = inject(LoginUseCase)
    
    @Get('/')
    async index() {
        return view('auth.login.index')
    }
    @Post('/',{
        csrf: true,
        validator: loginValidators
    })
    async doLogin(request:AppRequest<typeof loginValidators>) {

        const result = await this.#loginUser.execute(request.body);

        return result.match({
            left: (code:LoginTranslationKey) => JsonRes({ error: request.tr(code),}, {status:409}),

            right: (user:LoginResult) => {

                request.cookies.set("session", user.sessionId, {
                    httpOnly: true,
                    secure: true,
                    sameSite: "lax",
                    path: "/",
                });
                console.log(request.cookies.toSetCookieHeaders());
                return JsonRes(user, {status:201});
            },
        });
    }
}