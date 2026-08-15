import { Controller, Get, JsonRes, Post, view, type AppRequest } from "@warbler/http";
import { LoginUseCase } from "../../application/use-case/login.use-case";
import { WlbPgLoginRepository } from "../../infrastructure/persistance/wlb-pg-user.repository";
import { inject } from "@warbler/core";
import { loginValidators } from "../validators/login.validator";
import type { UserEntity } from "../../domain/entities/user.entity";
import type { LoginResult } from "../../application/dto/login-result";

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
            left: (code:string) => JsonRes({ error: request.tr(code),}, {status:409}),

            right: (user:LoginResult) => {
                return JsonRes(user, {status:201});
            },
        });
    }
}