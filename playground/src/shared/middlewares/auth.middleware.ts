import { inject } from "@warbler/framework";
import type { AppRequest, Middleware } from "@warbler/framework";
import { defineValidator, v } from "@warbler/framework";
import { SessionAuthenticator } from "../services/session-authenticator.service";

export const sessionCookieValidator = defineValidator({
    cookieRules: {
        session: v.string("validators.invalid_session").optional(),
    },
});

export const sessionMiddleware: Middleware<AppRequest<typeof sessionCookieValidator>> = async (request, context, next) => {

    const sessionAuthenticator = inject(SessionAuthenticator);

    const sessionId = request.cookies.session;

    if (!sessionId) {
        return next();
    }
    const auth = await sessionAuthenticator.authenticate(sessionId);

    if (auth) {
        context.set("auth", auth);
    }

    return next();
};
