export interface User {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
