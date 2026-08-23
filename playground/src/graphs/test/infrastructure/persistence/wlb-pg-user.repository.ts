import { Repository } from "@warbler/core";
import { password } from "@warbler/crypto";
import { WlbPg } from "@pg/client";
import type { UserEntity } from "../../domain/entities/user.entity";
import { FindUserRepositoryPort } from "../../domain/ports/user.repository.port";

@Repository({
    provide: FindUserRepositoryPort,
})
export class WlbPgFindUserRepository extends FindUserRepositoryPort {
    override async findUsers(): Promise<readonly any[]> {
        const exist = await WlbPg.user.exists({
            where: { 
                email: 'bellib6@gmail.com',  
                OR: [
                    { id: {
                        gt: '123e4567-e89b-12d3-a456-426614174000'
                    }}
                ]
            },

        });
        console.log('Yexist', exist)
        return WlbPg.products.findMany({
            take: 200
        });
    }

}
