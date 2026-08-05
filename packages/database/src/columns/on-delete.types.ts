export enum OnDeleteAction {
  Cascade = "CASCADE",
  SetNull = "SET NULL",
  SetDefault = "SET DEFAULT",
  Restrict = "RESTRICT",
  NoAction = "NO ACTION",
}

export type OnDeleteType =
  | "CASCADE"
  | "SET NULL"
  | "SET DEFAULT"
  | "RESTRICT"
  | "NO ACTION";
