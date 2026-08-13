import { Graph } from "@warbler/core";
import { RegisterController } from "./register/register.controller";

@Graph({
    prefix: '/auth',
    controllers: [
        RegisterController
    ]
})
export class AuthGraph {}