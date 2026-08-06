import { Repository } from "@warbler/core";
import { WlbPg } from "../../../database/warbler/pg/generated/client";

export interface PlaygroundUser {
  readonly id: string;
  readonly email: string;
}

@Repository()
export default class AuthRepository {
  async find(email: string, password: string): Promise<PlaygroundUser | undefined> {
    const user = await WlbPg.user.findUnique({ email });
    if (user === null || !user.isActive) return undefined;

    const valid = await Bun.password.verify(password, user.passwordHash);
    return valid ? Object.freeze({ id: user.id, email: user.email }) : undefined;
  }
}
