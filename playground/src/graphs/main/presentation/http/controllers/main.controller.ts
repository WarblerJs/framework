import { Controller, Get, view } from "@warbler/http";

@Controller()
export class MainController {
    
    @Get('/')
    index() {
        return view('main.index');
    }
}