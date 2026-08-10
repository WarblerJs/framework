import { Graph } from "@warbler/core";
import AuthController from "./auth.controller";
import AuthRepository from "./auth.repository";
import AuthService from "./auth.service";

@Graph({
 // prefix: "/api/auth",
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
})
export default class AuthGraph {}
