import type { PgMigration } from "@warblerjs/database";
import { PgDefault, PgTypes } from "@warblerjs/database";

export const up: PgMigration = async (pgm) => {
  await pgm.addColumns("users", {
    email: PgTypes.VarChar({ length: 255, nullable: false, unique: true }),
    passwordHash: PgTypes.Text({ nullable: false }),
    isActive: PgTypes.Boolean({ nullable: false, default: PgDefault.True }),
  });
};

export const down: PgMigration = async (pgm) => {
  await pgm.dropColumns("users", ["email", "password_hash", "is_active"]);
};
