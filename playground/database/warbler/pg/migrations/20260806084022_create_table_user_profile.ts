import type { PgMigration } from "@warblerjs/database";
import { OnDeleteAction, PgDefault, PgTypes } from "@warblerjs/database";

export const up: PgMigration = async (pgm) => {
  await pgm.createTable("user_profiles", {
    id: PgTypes.Uuid({ primaryKey: true, default: PgDefault.GenRandomUuid }),
    userId: PgTypes.Uuid({
      nullable: false,
      unique: true, // one profile per user
      references: { table: "users", column: "id" },
      onDelete: OnDeleteAction.Cascade,
    }),
    firstName: PgTypes.VarChar({ length: 100, nullable: true }),
    lastName: PgTypes.VarChar({ length: 100, nullable: true }),
    avatarUrl: PgTypes.Text({ nullable: true }),
    bio: PgTypes.Text({ nullable: true }),
    createdAt: PgTypes.Timestamp({ default: PgDefault.Now, nullable: false }),
    updatedAt: PgTypes.Timestamp({ default: PgDefault.Now, nullable: false }),
  });
};

export const down: PgMigration = async (pgm) => {
  await pgm.dropTable("user_profiles");
};
