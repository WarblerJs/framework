import { inject } from "@warbler/core";
import { ArchiveRes, Controller, Get, ImageRes, JsonRes, PdfRes, Post, Sse, SseRes, TextRes, csrf, view } from "@warbler/http";
import { SocketPublisher } from "@warbler/websocket";
import HomeService from "./home.service";

@Controller()
export default class HomeController {
  readonly #home = inject(HomeService);
  readonly #sockets = inject(SocketPublisher);

  @Get("/")
  index(): Response {
    return JsonRes(this.#home.status());
  }
  @Get("/bench")
  bench() {
    return new Response("OK");
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
    return ImageRes(Bun.file("public/images/sample.png"), { filename: "sample.png" });
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
