import { inject } from "@warbler/core";
import { Controller, Get, type AppRequest } from "@warbler/http";
import { BenchService } from "./bench.service";
import { benchValidator, optionalBenchQueryValidator } from "./bench.validator";

@Controller("/bench")
export default class Benchontroller {

    private readonly service = inject(BenchService);

    @Get("/")
    bench() {
        return new Response("Ok", {
            status: 200,
            headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "X-Custom-Header": "MyValue"
            },
        });
    }

    @Get("/di")
    benchDi() {
        return new Response(this.service.value());
    }

    @Get("/validation", {
        validator: benchValidator
    })
    benchValidation(req: AppRequest<typeof benchValidator>) {
        const id = req.query.id;

        if (!id) {
            return new Response("Missing id", { status: 400 });
        }

        const user = this.service.getById(id);
        return Response.json(user);
    }
    @Get("/query", {
        validator: optionalBenchQueryValidator,
    })
    benchQuery(req: AppRequest<typeof optionalBenchQueryValidator>) {
        const id = req.query.id;
        return new Response(id ? (id + '') : "");
    }
    @Get("/query-raw", {
        validator: optionalBenchQueryValidator,
    })
    benchQueryRaw(req: AppRequest<typeof optionalBenchQueryValidator>) {
        return new Response(req.query.id ?? "");
    }
    @Get("/query-fast", {
        validator: optionalBenchQueryValidator,
    })
    benchQueryFast(req: AppRequest<typeof optionalBenchQueryValidator>) {
        return new Response(req.query.id ?? "");
    }
    @Get("/query-ignore")
    benchQueryIgnore() {
        return new Response("OK");
    }
    @Get("/query-read-ignore", {
        validator: optionalBenchQueryValidator,
    })
    benchQueryReadIgnore(req: AppRequest<typeof optionalBenchQueryValidator>) {
        const id = req.query.id;
        void id;

        return new Response("OK");
    }
}
