import { inject } from "@warbler/core";
import { Controller, Get, type AppRequest } from "@warbler/http";
import { BenchService } from "./bench.service";
import { benchValidator } from "./bench.validator";

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
        //validator: benchValidator
    })
    benchValidation(req: AppRequest<typeof benchValidator>) {
        const id = req.query.id;

        if (!id) {
            return new Response("Missing id", { status: 400 });
        }

        const user = this.service.getById(id);
        return Response.json(user);
    }
    @Get("/query")
    benchQuery(req: AppRequest) {
        const id = req.query.id;
        return new Response(id ? (id + '') : "");
    }
    @Get("/query-raw")
    benchQueryRaw(req: AppRequest) {
        const url = new URL(req.native.url);
        const id = url.searchParams.get("id");

        return new Response(id ?? "");
    }
    @Get("/query-fast")
    benchQueryFast(req: AppRequest) {
        const url = req.native.url;

        const index = url.indexOf("id=");
        const id = index === -1
            ? ""
            : url.slice(index + 3);

        return new Response(id);
    }
    @Get("/query-ignore")
    benchQueryIgnore() {
        return new Response("OK");
    }
    @Get("/query-read-ignore")
    benchQueryReadIgnore(req: AppRequest) {
        const id = req.query.id;
        void id;

        return new Response("OK");
    }
}