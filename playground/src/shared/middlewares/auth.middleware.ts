import { inject } from "@warbler/core";
import type { Middleware } from "@warbler/http";
import { SessionAuthenticator } from "../services/session-authenticator.service";

export const sessionMiddleware: Middleware = async (request, context, next) => {

    const sessionAuthenticator = inject(SessionAuthenticator);

    const sessionId = request.cookies.get("session");

    if (!sessionId) {
        return next();
    }
    const auth = await sessionAuthenticator.authenticate(sessionId);

    if (auth) {
        context.set("auth", auth);
    }

    return next();
};
