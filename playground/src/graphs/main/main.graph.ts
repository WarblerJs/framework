import { Graph } from "@warbler/core";
import { MainController } from "./presentation/http/controllers/main.controller";


@Graph({
    prefix: '/',
    controllers: [
        MainController
    ]
})
export class MainGraph {}