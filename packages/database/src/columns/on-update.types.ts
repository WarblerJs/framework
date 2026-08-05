export enum OnUpdateAction {
  Cascade = "CASCADE",
  SetNull = "SET NULL",
  SetDefault = "SET DEFAULT",
  Restrict = "RESTRICT",
  NoAction = "NO ACTION",
}

export type OnUpdateType =
  | "CASCADE"
  | "SET NULL"
  | "SET DEFAULT"
  | "RESTRICT"
  | "NO ACTION";
