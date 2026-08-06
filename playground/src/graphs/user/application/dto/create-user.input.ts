export interface CreateUserInput {
  readonly email: string;
  readonly password: string;
  readonly isActive?: boolean;
}
