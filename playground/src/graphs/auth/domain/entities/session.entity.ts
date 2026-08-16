export interface SessionEntity {
    readonly id: string;
    readonly userId: string;
    readonly sessionHash: string;
    readonly ipAddress: string | null;
    readonly userAgent: string | null;
    readonly expiresAt: Date;
    readonly lastUsedAt: Date | null;
    readonly revokedAt: Date | null;
    readonly createdAt: Date;
    readonly updatedAt: Date;
}
