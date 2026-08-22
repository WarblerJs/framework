export interface UserEntity {
    readonly id: string;
    readonly email: string;
    readonly passwordHash: string;
}