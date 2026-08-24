import type { PgMigration } from "@warblerjs/database";
import { PgDefault, PgTypes } from "@warblerjs/database";

export const up: PgMigration = async (pgm) => {
  await pgm.createTable("roles", {
    id: PgTypes.Uuid({ primaryKey: true, default: PgDefault.GenRandomUuid }),
    name: PgTypes.VarChar({ length: 100, nullable: false, unique: true }),
    createdAt: PgTypes.Timestamp({ default: PgDefault.Now, nullable: false }),
    updatedAt: PgTypes.Timestamp({ default: PgDefault.Now, nullable: false }),
  });
};

export const down: PgMigration = async (pgm) => {
  await pgm.dropTable("roles");
};
