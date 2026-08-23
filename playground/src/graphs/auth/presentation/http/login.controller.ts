import { inject } from "@warbler/core";
import { Controller, Get, JsonRes, Post, view, type AppRequest } from "@warbler/http";
import { serializeCookie } from "@warbler/http/cookies";
import { LoginUseCase } from "../../application/use-case/login.use-case";
import { loginValidators } from "../validators/login.validator";
import { sessionCookieValidator, sessionMiddleware } from "src/shared/middlewares/auth.middleware";
import { env } from "@warbler/config";
import { authGuard, guestGuard } from "src/shared/guards/auth.guard";

@Controller({
    prefix: "/login",
    providers: [
        LoginUseCase,
    ],
})
export class LoginController {
    readonly #login = inject(LoginUseCase);

    @Get("/", {
        name: "login",
        validator: sessionCookieValidator,
        middleware: [ sessionMiddleware ],
        guards: [ guestGuard ],
    })
    index(request: AppRequest) {
 
        return view("auth.login.index");
    }

    @Get("/protected", {
        name: "protected",
        validator: sessionCookieValidator,
        middleware: [ sessionMiddleware ],
        guards: [ authGuard ],
    })
    protected() {
        return JsonRes({ ok: true, page: "protected" });
    }

    @Post("/", {
        csrf: true,
        validator: loginValidators,
    })
    async doLogin(request: AppRequest<typeof loginValidators>) {
        const result = await this.#login.execute(request.body);

        return result.match({
            left: (key) => JsonRes(
                { error: request.tr(key) },
                { status: 409 },
            ),
            right: (login) => {
                return JsonRes(login.user, {
                    status: 200,
                    headers: {
                        "set-cookie": serializeCookie("session", login.sessionId, {
                            httpOnly: true,
                            secure: env('APP_ENV') === 'production',
                            sameSite: "Lax",
                            path: "/",
                        }),
                    },
                });
            },
        });
    }
}
