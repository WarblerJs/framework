import { Repository } from "@warbler/core";
import { WlbPg } from "../../../database/warbler/pg/generated/client";
import type { UserRow } from "@pg/client/user";

export interface PlaygroundUser {
  readonly id: string;
  readonly email: string;
}

@Repository()
export default class AuthRepository {

  private async savManyUser() {
        

    const allUsers = this.generateRandomUsers(4000);

    // Use .map to create an array of database insert operations
    const insertPromises = allUsers.map(user => WlbPg.user.insert(user));
    
    // Bun processes these concurrently, pushing them all to Postgres at once
    await Promise.all(insertPromises);

  }
  async finAll(): Promise<UserRow[] | undefined> {

    return await WlbPg.user.findMany({
      limit: 100
    });

  }
  async find(email: string, password: string): Promise<PlaygroundUser | undefined> {

    const user = await WlbPg.user.findUnique({ email });

    await this.savManyUser();

    if (user === null || !user.isActive) return undefined;

    const valid = await Bun.password.verify(password, user.passwordHash);
    return valid ? Object.freeze({ id: user.id, email: user.email }) : undefined;
  }

  generateRandomUsers(count:number) {
    const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'example.com'];
    const words = ['user', 'dev', 'tester', 'geek', 'coder', 'swift', 'alpha', 'bright'];
  
    return Array.from({ length: count }, (_, i) => {

      const word = words[Math.floor(Math.random() * words.length)];
      const domain = domains[Math.floor(Math.random() * domains.length)];
      const timestamp = Date.now(); // e.g., 1718223948
 
      return {
        passwordHash: 'New password hash',
        email: `${word}${timestamp}_${i+1}@${domain}` ,
        isActive: true
      }
    });
  }
}
