import { Repository } from "@warbler/core";
import { LoginRepositoryPort, type LoginUserData } from "../../domain/ports/login.repository.port";
import type { UserEntity } from "../../domain/entities/user.entity";
import { WlbPg } from "@pg/client";

@Repository({
    provide: LoginRepositoryPort 
})
export class WlbPgLoginRepository extends LoginRepositoryPort {
    override loginUser(data: LoginUserData): Promise<UserEntity | null> {
        return WlbPg.user.findFirst({email: data.email});
    }
    override findUserByEmail(email: string): Promise<UserEntity | null> {
        return WlbPg.user.findFirst({email})
    }
  
}