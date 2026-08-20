import { inject } from "@warbler/core";
import { ArchiveRes, Controller, Get, ImageRes, JsonRes, PdfRes, Post, Sse, SseRes, TextRes, csrf, view, type AppRequest } from "@warbler/http";
import { SocketPublisher } from "@warbler/websocket";
import HomeService from "./home.service";
import { WlbPg } from "@pg/client";
import { password } from "bun";
import { random, hash } from "@warbler/crypto";

@Controller()
export default class HomeController {
  readonly #home = inject(HomeService);
  readonly #sockets = inject(SocketPublisher);

  @Get("/", { name: "home" })
  async index(request:AppRequest): Promise<Response> {

    const result = await WlbPg.products.findMany({

      select: {
        brand: true, 
      },
    
      orderBy: {
        brand: "asc",
      },
      take: 100
    });
     
    
    return JsonRes( result );
  }


  @Get("/health")
  async health(): Promise<Response> {
    return TextRes("OK");
  }

  @Post("/notifications")
  notify(): Response {
    const result = this.#sockets.publish("notifications", {
      event: "notification.created",
      data: { userId: 123 },
    });
    return JsonRes({ ok: true, result });
  }

  @Get("/page")
  page(): Response {
    return view("home.index", {
      title: "Warbler Playground",
      hello: 'World',
      test1: 'Awsdvf'
    });
  }

  @Get("/form")
  form(): Response {
    return view("home.form", {
      title: "Example Form",
      security: csrf(),
    });
  }

  @Get("/file/pdf")
  pdf(): Response {
    return PdfRes(Bun.file("public/downloads/sample.pdf"), { filename: "sample.pdf" });
  }

  @Get("/file/image")
  image(): Response {
    return ImageRes(Bun.file("public/images/logo.jpg"), { filename: "sample.png" });
  }

  @Get("/file/archive")
  archive(): Response {
    return ArchiveRes(Bun.file("public/downloads/sample.zip"), { filename: "sample.zip" });
  }

  @Sse("/events")
  events(): Response {
    return SseRes((async function* () {
      yield { event: "playground.ready", data: { ready: true }, id: "1" };
    })());
  }
}
