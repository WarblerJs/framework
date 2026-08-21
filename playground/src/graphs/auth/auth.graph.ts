import { Graph, Provider } from "@warbler/core";
import { SessionRepositoryPort } from "./domain/ports/session.repository.port";
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
        Provider({ provide: SessionRepositoryPort, useExisting: WlbPgSessionRepository }),
    ],
})
export class AuthGraph {}


