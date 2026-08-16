import type { PgMigration } from "@warbler/database";
import {
  OnDeleteAction,
  PgDefault,
  PgTypes,
} from "@warbler/database";

export const up: PgMigration = async (pgm) => {
  await pgm.createTable("user_sessions", {
    id: PgTypes.Uuid({
      primaryKey: true,
      default: PgDefault.GenRandomUuid,
    }),

    userId: PgTypes.Uuid({
      nullable: false,
      references: {
        table: "users",
        column: "id",
      },
      onDelete: OnDeleteAction.Cascade,
    }),

    sessionHash: PgTypes.Text({
      nullable: false,
      unique: true,
    }),

    ipAddress: PgTypes.Text({
      nullable: true,
    }),

    userAgent: PgTypes.Text({
      nullable: true,
    }),

    expiresAt: PgTypes.Timestamp({
      nullable: false,
    }),

    lastUsedAt: PgTypes.Timestamp({
      nullable: true,
    }),

    revokedAt: PgTypes.Timestamp({
      nullable: true,
    }),

    createdAt: PgTypes.Timestamp({
      default: PgDefault.Now,
      nullable: false,
    }),

    updatedAt: PgTypes.Timestamp({
      default: PgDefault.Now,
      nullable: false,
    }),
  });
};

export const down: PgMigration = async (pgm) => {
  await pgm.dropTable("user_sessions");
};