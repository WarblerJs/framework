// @ts-nocheck
import {
    Service,
  } from "@warbler/core";
@Service()
export default class AuthService {

    authRepository = inject(AuthRepository);

    async login(username: string, password: string) {
        // Implement your login logic here
        return this.authRepository.findUserByUsernameAndPassword(username, password);
    }

    async register(username: string, password: string) {
        // Implement your registration logic here
        return this.authRepository.createUser(username, password);
    }
}
