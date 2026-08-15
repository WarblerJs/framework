import { Controller, csrf, Get, JsonRes, Post, view, type AppRequest } from "@warbler/http";
import { registerValidator } from "../validators/register.validator";
import { inject } from "@warbler/core";
import { RegisterUseCase } from "../../application/use-case/register.use-case";
import type { UserEntity } from "../../domain/entities/user.entity";
import { WlbPgRegisterRepository } from "../../infrastructure/persistance/wlb-pg-user.repository";

@Controller({
    prefix: '/register',
    providers: [
        WlbPgRegisterRepository,
        RegisterUseCase
    ]
})
export class RegisterController {

    readonly registerUseCase = inject(RegisterUseCase);
    
    @Get('/')
    index(){
        return view('auth.register.index')
    }
    @Post('/',{
        validator: registerValidator,
        csrf: true
    })
    async newUser(request:AppRequest<typeof registerValidator>){
        const result:any = await this.registerUseCase.execute(request.body);
        
        return result.match({
            left: (code:string) => {
                return JsonRes({ error: request.tr(code),}, {status:409});
            },
        
            right: (user:UserEntity) => {
                return JsonRes(user, {status:201});
            },
        });
    }
}