// @ts-nocheck
import {
    Graph,
    Service,
    inject,
    createApp,
  } from "@warbler/core";
  
  import {
    Controller,
    Get,
    Post,
    type AppRequest,
    JsonRes,
    HtmlRes,
  } from "@warbler/http";
  
  import { view } from "@warbler/view";

import { loginValidator } from './auth.validator';
import { loginGuard } from './auth.guard';
import AuthPolicy from './auth.policy';

@Controller({
    middlewares: []
})
export default class AuthController {

    authService = inject(AuthService);

    @Get('/login',{
        name: "auth.login",
        validator: loginValidator,
        guards: [ loginGuard ],
        policy: AuthPolicy.login,
    })
    async login(req: AppRequest) : Promise<JsonRes> {
        const { username, password } = req.body;
        return JsonRes(await this.authService.login(username, password));
    }

    @Post('/register',{
        name: "auth.register",
        validator: registerValidator,
        guards: [ registerGuard ],
    })
    async register(req: AppRequest) : Promise<HtmlRes> {
        const { username, password } = req.body;
        return view('auth.register', { 
            data: await this.authService.register(username, password),
            username, 
            password 
        });
    }
}