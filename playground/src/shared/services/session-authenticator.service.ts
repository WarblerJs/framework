import { inject, Service } from "@warbler/core";
import { hash } from "@warbler/crypto";
import { WlbPgSessionRepository } from "../../graphs/auth/infrastructure/persistence/wlb-pg-session.repository";

@Service({ provide: "root" })
export class SessionAuthenticator {
    readonly #sessions = inject(WlbPgSessionRepository);

    async authenticate(sessionId: string) {
        console.log('hash.sha256(sessionId)>>',hash.sha256(sessionId))
        return this.#sessions.findActiveByHash(hash.sha256(sessionId));
    }
}
