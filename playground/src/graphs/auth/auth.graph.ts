import { Graph } from "@warbler/core";
import { RegisterController } from "./register/presentation/http/register.controller";
import { WlbPgRegisterRepository } from "./register/infrastructure/persistance/wlb-pg-user.repository";
import { RegisterUseCase } from "./register/application/use-case/register.use-case";

@Graph({
    prefix: '/auth',
    controllers: [
        RegisterController
    ],
    providers: []
})
export class AuthGraph {}