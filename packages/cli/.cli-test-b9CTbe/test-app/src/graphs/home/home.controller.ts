import { Controller, Get, JsonRes } from "@warbler/http";

@Controller()
export default class HomeController {
  @Get("/")
  index(): Response { return JsonRes({ message: "Warbler" }); }
}
