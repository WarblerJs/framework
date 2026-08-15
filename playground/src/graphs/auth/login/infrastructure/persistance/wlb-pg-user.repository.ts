import { Repository } from "@warbler/core";
import { LoginRepositoryPort } from "../../domain/ports/login.repository.port";
import type { UserEntity } from "../../domain/entities/user.entity";
import { WlbPg } from "@pg/client";
import type { FindUserParams } from "../../domain/repositories/find-user.params";

@Repository({
    provide: LoginRepositoryPort 
})
export class WlbPgLoginRepository extends LoginRepositoryPort {
    override loginUser(params: FindUserParams): Promise<UserEntity | null> {
        return WlbPg.user.findFirst({email: params.email});
    }
    override findUserByEmail(email: string): Promise<UserEntity | null> {
        return WlbPg.user.findFirst({email})
    }
  
}