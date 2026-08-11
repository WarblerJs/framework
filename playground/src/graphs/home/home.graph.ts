import { Graph } from "@warbler/core";
import HomeController from "./home.controller";
import ApplicationLogger from "./application-logger";
import HomeService from "./home.service";

@Graph({
  prefix: "/",
  controllers: [HomeController],
  //providers: [ApplicationLogger, HomeService],
})
export default class HomeGraph {}
