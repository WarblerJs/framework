import { inject } from "@warbler/core";
import { ArchiveRes, Controller, Get, ImageRes, JsonRes, PdfRes, Post, Sse, SseRes, TextRes, csrf, view } from "@warbler/http";
import { SocketPublisher } from "@warbler/websocket";
import HomeService from "./home.service";
import { WlbPg } from "@pg/client";
import { password } from "bun";

@Controller()
export default class HomeController {
  readonly #home = inject(HomeService);
  readonly #sockets = inject(SocketPublisher);

  @Get("/", { name: "home" })
  async index(): Promise<Response> {
    // user id 3e44a1cf-162b-45b4-a7ca-8d178c835a39
    const session = await WlbPg.user.deleteMany({
      where: {
        isActive: true
      }
    });
    return JsonRes({ s: this.#home.status(), session });
  }
  private generateRandomEmail() {
    const chars = 'abcdefghijklmnopqrstuvwxyz1234567890';
    let username = '';
    
    // Generate an 8-character random username
    for (let i = 0; i < 8; i++) {
      username += chars[Math.floor(Math.random() * chars.length)];
    }
    
    const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'example.com'];
    const randomDomain = domains[Math.floor(Math.random() * domains.length)];
    
    return `${username}@${randomDomain}`;
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
