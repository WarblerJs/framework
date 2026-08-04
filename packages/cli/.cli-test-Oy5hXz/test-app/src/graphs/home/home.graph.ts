import { Graph } from "@warbler/core";
import HomeController from "./home.controller";

@Graph({ prefix: "/", controllers: [HomeController], providers: [] })
export default class HomeGraph {}
