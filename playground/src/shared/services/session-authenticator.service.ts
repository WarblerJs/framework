import { inject, Service } from "@warbler/framework";
import { hash } from "@warbler/crypto";

@Service({ provide: "root" })
export class SessionAuthenticator {

    async authenticate(sessionId: string) {
        console.log('hash.sha256(sessionId)>>',hash.sha256(sessionId))
        return true;
    }
}
