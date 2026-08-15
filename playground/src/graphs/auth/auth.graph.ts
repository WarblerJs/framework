import { Graph } from "@warbler/core";
import { RegisterController } from "./register/presentation/http/register.controller";
import { LoginController } from "./login/presentation/http/login.controller";

@Graph({
    prefix: '/auth',
    controllers: [
        RegisterController,
        LoginController
    ],
    providers: []
})
export class AuthGraph {}