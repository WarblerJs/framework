import { Controller, Get, JsonRes, Post, view } from "@warbler/http";

@Controller({
    prefix: '/login',
})
export class LoginController {
    
    @Get('/')
    async index() {
        return view('auth.login.index')
    }
    @Post('/')
    async doLogin() {
        return JsonRes({login:true});
    }
}