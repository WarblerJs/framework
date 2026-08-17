import { Repository } from "@warbler/core";
import { password } from "@warbler/crypto";
import { WlbPg } from "@pg/client";
import type { UserEntity } from "../../domain/entities/user.entity";
import { AuthRepositoryPort, type CreateUserData } from "../../domain/ports/auth.repository.port";

@Repository({
    provide: AuthRepositoryPort,
})
export class WlbPgAuthRepository extends AuthRepositoryPort {
    override findUserByEmail(email: string): Promise<UserEntity | null> {
        return WlbPg.user.findFirst({ where: { email } });
    }

    override async createUser(data: CreateUserData): Promise<UserEntity> {
        const passwordHash = await password.hash(data.password);

        return WlbPg.user.insert({
            email: data.email,
            passwordHash,
        });
    }
}
