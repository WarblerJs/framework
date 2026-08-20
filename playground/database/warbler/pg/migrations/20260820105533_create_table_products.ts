import type { PgMigration } from "@warbler/database";
import { PgDefault, PgTypes } from "@warbler/database";

export const up: PgMigration = async (pgm) => {
  await pgm.createTable("productses", {
    
    id: PgTypes.Serial({
      primaryKey: true,
     // default: PgDefault.GenRandomUuid,
    }),

    sku: PgTypes.VarChar({
      length: 100,
      nullable: false,
      unique: true,
    }),

    name: PgTypes.VarChar({
      length: 255,
      nullable: false,
    }),

    category: PgTypes.VarChar({
      length: 100,
      nullable: false,
    }),

    brand: PgTypes.VarChar({
      length: 100,
      nullable: false,
    }),

    status: PgTypes.VarChar({
      length: 30,
      nullable: false,
    }),

    price: PgTypes.Decimal({
      precision: 12,
      scale: 2,
      nullable: false,
    }),

    costPrice: PgTypes.Decimal({
      precision: 12,
      scale: 2,
      nullable: false,
    }),

    stock: PgTypes.Integer({
      nullable: false,
      default: 0,
    }),

    soldQuantity: PgTypes.Integer({
      nullable: false,
      default: 0,
    }),

    rating: PgTypes.Decimal({
      precision: 3,
      scale: 2,
      nullable: true,
    }),

    weight: PgTypes.Decimal({
      precision: 10,
      scale: 3,
      nullable: true,
    }),

    discountPercent: PgTypes.Integer({
      nullable: true,
    }),

    isActive: PgTypes.Boolean({
      nullable: false,
      default: true,
    }),

    isFeatured: PgTypes.Boolean({
      nullable: false,
      default: false,
    }),
    createdAt: PgTypes.Timestamp({ default: PgDefault.Now, nullable: false }),
    updatedAt: PgTypes.Timestamp({ default: PgDefault.Now, nullable: false }),
    deletedAt: PgTypes.Timestamp({ nullable: true }),
  }, { softDelete: true });
};

export const down: PgMigration = async (pgm) => {
  await pgm.dropTable("productses");
};
