
import {
  Graph,
} from "@warbler/core";
import AuthController  from "./auth.controller";
import AuthService  from "./auth.service";
import AuthRepository from "./auth.repository";

@Graph({
  prefix: "/api/auth",
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
  ],
})
export default class AuthGraph {}