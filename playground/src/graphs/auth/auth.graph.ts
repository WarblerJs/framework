import { Graph } from "@warbler/core";
import { WlbPgAuthRepository } from "./infrastructure/persistence/wlb-pg-auth.repository";
import { WlbPgSessionRepository } from "./infrastructure/persistence/wlb-pg-session.repository";
import { LoginController } from "./presentation/http/login.controller";
import { RegisterController } from "./presentation/http/register.controller";

@Graph({
    prefix: "/auth",
    controllers: [
        RegisterController,
        LoginController,
    ],
    providers: [
        WlbPgAuthRepository,
        WlbPgSessionRepository,
    ],
})
export class AuthGraph {}
