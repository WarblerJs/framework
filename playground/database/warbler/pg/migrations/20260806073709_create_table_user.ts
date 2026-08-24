import type { PgMigration } from "@warblerjs/database";
import { PgDefault, PgTypes } from "@warblerjs/database";

export const up: PgMigration = async (pgm) => {
  await pgm.createTable("users", {
    id: PgTypes.Uuid({ primaryKey: true, default: PgDefault.GenRandomUuid }),
    createdAt: PgTypes.Timestamp({ default: PgDefault.Now, nullable: false }),
    updatedAt: PgTypes.Timestamp({ default: PgDefault.Now, nullable: false }),
  });
};

export const down: PgMigration = async (pgm) => {
  await pgm.dropTable("users");
};
