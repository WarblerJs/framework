import type { SessionEntity } from "../entities/session.entity";

export interface CreateSessionData {
    readonly userId: string;
    readonly sessionHash: string;
    readonly expiresAt: Date;
    readonly ipAddress?: string | null;
    readonly userAgent?: string | null;
}

export abstract class SessionRepositoryPort {
    abstract createSession(data: CreateSessionData): Promise<SessionEntity>;
    abstract findActiveByHash(sessionHash: string): Promise<SessionEntity | null>;
    abstract revokeByHash(sessionHash: string): Promise<void>;
    abstract revokeAllForUser(userId: string): Promise<void>;
}
