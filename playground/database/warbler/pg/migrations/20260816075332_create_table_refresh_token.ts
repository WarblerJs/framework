import type { PgMigration } from "@warbler/database";
import {
  OnDeleteAction,
  PgDefault,
  PgTypes,
} from "@warbler/database";

export const up: PgMigration = async (pgm) => {
  await pgm.createTable("refresh_tokens", {
    id: PgTypes.Uuid({
      primaryKey: true,
      default: PgDefault.GenRandomUuid,
    }),

    tokenHash: PgTypes.Text({
      nullable: false,
      unique: true,
    }),

    familyId: PgTypes.Uuid({
      nullable: false,
    }),

    userId: PgTypes.Uuid({
      nullable: false,
      references: {
        table: "users",
        column: "id",
      },
      onDelete: OnDeleteAction.Cascade,
    }),

    used: PgTypes.Boolean({
      nullable: false,
      default: false,
    }),

    revoked: PgTypes.Boolean({
      nullable: false,
      default: false,
    }),

    userAgent: PgTypes.Text({
      nullable: true,
    }),

    ipAddress: PgTypes.Text({
      nullable: true,
    }),

    expiresAt: PgTypes.Timestamp({
      nullable: false,
    }),

    usedAt: PgTypes.Timestamp({
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

  //pgm.createIndex('refresh_tokens',)
};

export const down: PgMigration = async (pgm) => {
  await pgm.dropTable("refresh_tokens");
};