import { Repository } from "@warbler/core";
import { RegisterRepositoryPort, type CreateUserData } from "../../domain/ports/register.repository.port";
import type { UserEntity } from "../../domain/entities/user.entity";
import { WlbPg } from "@pg/client";
import { crypt, password } from "@warbler/crypto";

@Repository({
    provide: RegisterRepositoryPort
})
export class WlbPgRegisterRepository extends RegisterRepositoryPort {
    override async createNewUser(data: CreateUserData): Promise<UserEntity> {
        return WlbPg.user.insert({
            email: data.email,
            passwordHash: await password.hash(data.password)
        })
    }
    override async emailExist(email: string): Promise<UserEntity | null> {
        return await WlbPg.user.findFirst({email});
    }

}