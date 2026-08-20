import type { PgMigration } from "@warbler/database";
import { PgDefault, PgTypes } from "@warbler/database";

export const up: PgMigration = async (pgm) => {
  await pgm.createTable("logses", {
    id: PgTypes.Uuid({ primaryKey: true, default: PgDefault.GenRandomUuid }),
    createdAt: PgTypes.Timestamp({ default: PgDefault.Now, nullable: false }),
    updatedAt: PgTypes.Timestamp({ default: PgDefault.Now, nullable: false }),
  }, { softDelete: false });
};

export const down: PgMigration = async (pgm) => {
  await pgm.dropTable("logses");
};
