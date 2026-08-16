import type { UserEntity } from "../../domain/entities/user.entity";

export type LoginResult = {
    readonly user: UserEntity;
    readonly sessionId: string;
};
