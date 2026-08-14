import { Controller, csrf, Get, JsonRes, Post, view, type AppRequest } from "@warbler/http";
import { registerValidator } from "../validators/register.validator";
import { inject } from "@warbler/core";
import { RegisterUseCase } from "../../application/use-case/register.use-case";

@Controller('/register')
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
        const res:any = await this.registerUseCase.execute(request.body);
        if(res.success === false ) {
            return JsonRes(res,{status:402});
        } else {
            return JsonRes(res);

        }

        return res
    }
}