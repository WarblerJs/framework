import { Controller, Get, JsonRes, view } from "@warbler/http";

@Controller('/register')
export class RegisterController {
    
    @Get('/')
    index(){
        return view('auth.register.index')
    }
}