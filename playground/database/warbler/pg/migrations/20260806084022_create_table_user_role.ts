import type { PgMigration } from "@warblerjs/database";
import { OnDeleteAction, PgDefault, PgTypes } from "@warblerjs/database";

export const up: PgMigration = async (pgm) => {
  await pgm.createTable("user_roles", {
    id: PgTypes.Uuid({ primaryKey: true, default: PgDefault.GenRandomUuid }),
    userId: PgTypes.Uuid({
      nullable: false,
      references: { table: "users", column: "id" },
      onDelete: OnDeleteAction.Cascade,
    }),
    roleId: PgTypes.Uuid({
      nullable: false,
      references: { table: "roles", column: "id" },
      onDelete: OnDeleteAction.Cascade,
      index: true,
    }),
    createdAt: PgTypes.Timestamp({ default: PgDefault.Now, nullable: false }),
  });
  await pgm.createIndex("user_roles", ["user_id", "role_id"], { unique: true });
};

export const down: PgMigration = async (pgm) => {
  await pgm.dropTable("user_roles");
};
