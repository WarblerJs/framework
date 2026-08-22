import { Repository } from "@warbler/core";
import { password } from "@warbler/crypto";
import { WlbPg } from "@pg/client";
import type { UserEntity } from "../../domain/entities/user.entity";
import { FindUserRepositoryPort } from "../../domain/ports/user.repository.port";

@Repository({
    provide: FindUserRepositoryPort,
})
export class WlbPgFindUserRepository extends FindUserRepositoryPort {
    override findUsers(): Promise<readonly any[]> {
        return WlbPg.products.findMany({
            take: 200
        });
    }

}
