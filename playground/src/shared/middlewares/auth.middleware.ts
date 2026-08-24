import { inject } from "@warblerjs/framework";
import type { AppRequest, Middleware } from "@warblerjs/framework";
import { defineValidator, v } from "@warblerjs/framework";
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
