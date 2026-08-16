import { inject } from "@warbler/core";
import { Controller, Get, JsonRes, Post, view, type AppRequest } from "@warbler/http";
import { RegisterUseCase } from "../../application/use-case/register.use-case";
import { registerValidator } from "../validators/register.validator";

@Controller({
    prefix: "/register",
    providers: [
        RegisterUseCase,
    ],
})
export class RegisterController {
    readonly #register = inject(RegisterUseCase);

    @Get("/")
    index() {
        return view("auth.register.index");
    }

    @Post("/", {
        validator: registerValidator,
        csrf: true,
    })
    async newUser(request: AppRequest<typeof registerValidator>) {
        const result = await this.#register.execute(request.body);

        return result.match({
            left: (key) => JsonRes(
                { error: request.tr(key) },
                { status: 409 },
            ),
            right: (user) => JsonRes(user, { status: 201 }),
        });
    }
}
