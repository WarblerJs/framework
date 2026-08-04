import { Repository } from "@warbler/core";

export interface PlaygroundUser {
  readonly id: string;
  readonly username: string;
}

@Repository()
export default class AuthRepository {
  find(username: string, password: string): PlaygroundUser | undefined {
    return username === "warbler" && password === "secure-pass"
      ? Object.freeze({ id: "user-1", username })
      : undefined;
  }
}
