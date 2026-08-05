export enum PgDefault {
  Now = "now()",
  CurrentDate = "CURRENT_DATE",
  CurrentTime = "CURRENT_TIME",
  CurrentTimestamp = "CURRENT_TIMESTAMP",
  LocalTime = "LOCALTIME",
  LocalTimestamp = "LOCALTIMESTAMP",

  GenRandomUuid = "gen_random_uuid()",
  UuidGenerateV4 = "uuid_generate_v4()",

  True = "true",
  False = "false",

  Null = "NULL",
}

export type PgDefaultTypes =
  | "now()"
  | "CURRENT_DATE"
  | "CURRENT_TIME"
  | "CURRENT_TIMESTAMP"
  | "LOCALTIME"
  | "LOCALTIMESTAMP"
  | "gen_random_uuid()"
  | "uuid_generate_v4()"
  | "true"
  | "false"
  | "NULL";
