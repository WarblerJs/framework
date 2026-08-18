import { Repository } from "@warbler/core";
import { WlbPg } from "@pg/client";
import type { SessionEntity } from "../../domain/entities/session.entity";
import {
    SessionRepositoryPort,
    type CreateSessionData,
} from "../../domain/ports/session.repository.port";

@Repository({
    provide: 'root',
})
export class WlbPgSessionRepository extends SessionRepositoryPort {
    override createSession(data: CreateSessionData): Promise<SessionEntity> {
        return WlbPg.userSession.insert({
            userId: data.userId,
            sessionHash: data.sessionHash,
            ipAddress: data.ipAddress ?? null,
            userAgent: data.userAgent ?? null,
            expiresAt: data.expiresAt,
        });
    }

    override async findActiveByHash(
        sessionHash: string,
    ): Promise<SessionEntity | null> {
        const session = await WlbPg.userSession.findFirst({
            where: { 
                sessionHash, 
                revokedAt: null ,
                expiresAt: {
                 gt: new Date()
                }
            },
        });
        console.log('session',session)
    
        if (!session) {
            return null;
        }
    
        // if (session.revokedAt !== null) {
        //     return null;
        // }
    
        // if (session.expiresAt <= new Date()) {
        //     return null;
        // }
    
        return session;
    }

    override async revokeByHash(sessionHash: string): Promise<void> {
        await WlbPg.userSession.updateMany({
            where: { sessionHash, revokedAt: null },
            data: { revokedAt: new Date() },
        });
    }

    override async revokeAllForUser(userId: string): Promise<void> {
        await WlbPg.userSession.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
    }
}
