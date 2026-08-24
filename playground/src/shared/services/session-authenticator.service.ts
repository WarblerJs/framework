import { inject, Service } from "@warblerjs/framework";
import { hash } from "@warblerjs/crypto";

@Service({ provide: "root" })
export class SessionAuthenticator {

    async authenticate(sessionId: string) {
        console.log('hash.sha256(sessionId)>>',hash.sha256(sessionId))
        return true;
    }
}
