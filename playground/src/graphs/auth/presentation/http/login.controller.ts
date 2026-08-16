import { inject } from "@warbler/core";
import { Controller, Get, JsonRes, Post, view, type AppRequest } from "@warbler/http";
import { LoginUseCase } from "../../application/use-case/login.use-case";
import { loginValidators } from "../validators/login.validator";

@Controller({
    prefix: "/login",
    providers: [
        LoginUseCase,
    ],
})
export class LoginController {
    readonly #login = inject(LoginUseCase);

    @Get("/")
    index() {
        return view("auth.login.index");
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
                request.cookies.set("session", login.sessionId, {
                    httpOnly: true,
                    secure: true,
                    sameSite: "lax",
                    path: "/",
                });

                return JsonRes(login.user, { status: 200 });
            },
        });
    }
}
