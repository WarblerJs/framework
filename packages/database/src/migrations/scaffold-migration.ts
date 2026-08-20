import { MigrationScaffoldError } from "../errors";
import { deriveTableName } from "../naming";
import { formatTimestamp } from "../utils/timestamp";

const KINDS = [
  "create:table",
  "alter:table",
  "rename:table",
  "drop:table",
  "add:column",
  "alter:column",
  "rename:column",
  "drop:column",
  "create:unique:index",
  "create:index",
  "drop:index",
  "create:enum",
  "alter:enum",
  "raw:custom",
] as const;

type MigrationKind = (typeof KINDS)[number];

export interface ScaffoldedMigration {
  readonly fileName: string;
  readonly content: string;
}

export interface ScaffoldMigrationOptions {
  readonly softDelete?: boolean;
}

function parseKindAndName(arg: string): Readonly<{ kind: MigrationKind; name: string }> {
  for (const kind of KINDS) {
    const prefix = `${kind}:`;
    if (arg.startsWith(prefix)) {
      const name = arg.slice(prefix.length);
      if (name.length === 0) throw new MigrationScaffoldError(`Missing name after "${kind}:".`);
      return Object.freeze({ kind, name });
    }
  }
  throw new MigrationScaffoldError(`Unknown migration kind in "${arg}". Supported: ${KINDS.join(", ")}.`);
}

const header = 'import type { PgMigration } from "@warbler/database";\n';
const headerWithBuilders = 'import type { PgMigration } from "@warbler/database";\nimport { PgDefault, PgTypes } from "@warbler/database";\n';

function content(kind: MigrationKind, name: string, options: ScaffoldMigrationOptions): string {
  switch (kind) {
    case "create:table": {
      const table = deriveTableName(name);
      const softDelete = options.softDelete !== false;
      return `${headerWithBuilders}
export const up: PgMigration = async (pgm) => {
  await pgm.createTable(${JSON.stringify(table)}, {
    id: PgTypes.Uuid({ primaryKey: true, default: PgDefault.GenRandomUuid }),
    createdAt: PgTypes.Timestamp({ default: PgDefault.Now, nullable: false }),
    updatedAt: PgTypes.Timestamp({ default: PgDefault.Now, nullable: false }),
${softDelete ? "    deletedAt: PgTypes.Timestamp({ nullable: true }),\n" : ""}  }, { softDelete: ${String(softDelete)} });
};

export const down: PgMigration = async (pgm) => {
  await pgm.dropTable(${JSON.stringify(table)});
};
`;
    }
    case "drop:table": {
      const table = deriveTableName(name);
      return `${header}
export const up: PgMigration = async (pgm) => {
  await pgm.dropTable(${JSON.stringify(table)});
};

export const down: PgMigration = async (_pgm) => {
  // TODO: recreate "${table}" via pgm.createTable(...) if this needs to be reversible.
};
`;
    }
    case "rename:table":
      return `${header}
export const up: PgMigration = async (pgm) => {
  await pgm.renameTable("TODO_FROM_TABLE", "TODO_TO_TABLE"); // ${name}
};

export const down: PgMigration = async (pgm) => {
  await pgm.renameTable("TODO_TO_TABLE", "TODO_FROM_TABLE");
};
`;
    case "alter:table":
      return `${header}
export const up: PgMigration = async (_pgm) => {
  // TODO: alter table for "${name}" — e.g. pgm.addColumns(...), pgm.alterColumn(...), pgm.dropColumns(...)
};

export const down: PgMigration = async (_pgm) => {
  // TODO: reverse the change above.
};
`;
    case "add:column":
      return `${headerWithBuilders}
export const up: PgMigration = async (pgm) => {
  await pgm.addColumns("TODO_TABLE", {
    // ${name}: PgTypes.Text(),
  });
};

export const down: PgMigration = async (pgm) => {
  await pgm.dropColumns("TODO_TABLE", ["TODO_COLUMN"]);
};
`;
    case "drop:column":
      return `${header}
export const up: PgMigration = async (pgm) => {
  await pgm.dropColumns("TODO_TABLE", ["TODO_COLUMN"]); // ${name}
};

export const down: PgMigration = async (_pgm) => {
  // TODO: recreate the dropped column via pgm.addColumns(...) if this needs to be reversible.
};
`;
    case "alter:column":
      return `${header}
export const up: PgMigration = async (pgm) => {
  await pgm.alterColumn("TODO_TABLE", "TODO_COLUMN", {
    // nullable: false,
    // default: "value",
  }); // ${name}
};

export const down: PgMigration = async (pgm) => {
  await pgm.alterColumn("TODO_TABLE", "TODO_COLUMN", {
    // TODO: reverse the change above.
  });
};
`;
    case "rename:column":
      return `${header}
export const up: PgMigration = async (pgm) => {
  await pgm.renameColumn("TODO_TABLE", "TODO_FROM_COLUMN", "TODO_TO_COLUMN"); // ${name}
};

export const down: PgMigration = async (pgm) => {
  await pgm.renameColumn("TODO_TABLE", "TODO_TO_COLUMN", "TODO_FROM_COLUMN");
};
`;
    case "create:index":
    case "create:unique:index": {
      const unique = kind === "create:unique:index";
      return `${header}
export const up: PgMigration = async (pgm) => {
  await pgm.createIndex("TODO_TABLE", ["TODO_COLUMN"], { unique: ${String(unique)} }); // ${name}
};

export const down: PgMigration = async (pgm) => {
  await pgm.dropIndex("TODO_TABLE_TODO_COLUMN_${unique ? "key" : "idx"}");
};
`;
    }
    case "drop:index":
      return `${header}
export const up: PgMigration = async (pgm) => {
  await pgm.dropIndex("TODO_INDEX_NAME"); // ${name}
};

export const down: PgMigration = async (_pgm) => {
  // TODO: recreate the index via pgm.createIndex(...) if this needs to be reversible.
};
`;
    case "create:enum":
      return `${header}
export const up: PgMigration = async (pgm) => {
  await pgm.createEnum(${JSON.stringify(name)}, ["TODO_VALUE_1", "TODO_VALUE_2"]);
};

export const down: PgMigration = async (pgm) => {
  await pgm.dropEnum(${JSON.stringify(name)});
};
`;
    case "alter:enum":
      return `${header}
export const up: PgMigration = async (pgm) => {
  await pgm.alterEnum(${JSON.stringify(name)}, { addValues: ["TODO_VALUE"] });
};

export const down: PgMigration = async (_pgm) => {
  // TODO: Postgres cannot remove enum values — reversing this requires recreating the type.
};
`;
    case "raw:custom":
      return `${header}
export const up: PgMigration = async (pgm) => {
  await pgm.raw(\`-- TODO: write raw SQL for "${name}"\`);
};

export const down: PgMigration = async (pgm) => {
  await pgm.raw(\`-- TODO: write the reverse SQL\`);
};
`;
  }
}

/** Scaffolds a new timestamped migration file for one of the 14 supported `kind:name` labels. */
export function scaffoldMigration(arg: string, now: Date = new Date(), options: ScaffoldMigrationOptions = {}): ScaffoldedMigration {
  const { kind, name } = parseKindAndName(arg);
  const fileName = `${formatTimestamp(now)}_${arg.replaceAll(":", "_")}.ts`;
  return Object.freeze({ fileName, content: content(kind, name, options) });
}
