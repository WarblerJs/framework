import { inject } from "@warbler/core";
import { ArchiveRes, Controller, Get, HtmlRes, ImageRes, JsonRes, PdfRes, Sse, SseRes, TextRes } from "@warbler/http";
import HomeService from "./home.service";

@Controller()
export default class HomeController {
  readonly #home = inject(HomeService);

  @Get("/")
  index(): Response {
    return JsonRes(this.#home.status());
  }

  @Get("/health")
  async health(): Promise<Response> {
    return TextRes("OK");
  }

  @Get("/page")
  page(): Response {
    return HtmlRes("<!doctype html><html><body><h1>Warbler Playground</h1></body></html>");
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
