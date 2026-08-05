/** Lowercases the first letter of a PascalCase model name for its client property, e.g. `User` -> `user`. */
export function deriveClientKey(modelName: string): string {
  return modelName.length === 0 ? modelName : modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

function toSnakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1_$2")
    .toLowerCase();
}

function toCamelCase(name: string): string {
  return name.replace(/_+([a-z0-9])/gu, (_match, letter: string) => letter.toUpperCase());
}

function toPascalCase(name: string): string {
  const camel = toCamelCase(name);
  return camel.length === 0 ? camel : camel.charAt(0).toUpperCase() + camel.slice(1);
}

/** Regular English pluralization only. Irregular plurals require a `migrations.modelNames` override. */
function pluralize(word: string): string {
  if (/(?:s|x|z|ch|sh)$/iu.test(word)) return `${word}es`;
  if (/[^aeiou]y$/iu.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** Regular English singularization only — the inverse of `pluralize`. */
function singularize(word: string): string {
  if (/ies$/iu.test(word) && word.length > 3) return `${word.slice(0, -3)}y`;
  if (/(?:ses|xes|zes|ches|shes)$/iu.test(word)) return word.slice(0, -2);
  if (/s$/iu.test(word) && !/ss$/iu.test(word)) return word.slice(0, -1);
  return word;
}

/** Derives a table name suggestion from a singular scaffold argument, e.g. `user` -> `users`. Used only by migration scaffolding. */
export function deriveTableName(singularName: string): string {
  return pluralize(toSnakeCase(singularName));
}

/** Derives a snake_case SQL column name, e.g. `passwordHash` -> `password_hash`. Used only by migration scaffolding. */
export function deriveColumnName(fieldName: string): string {
  return toSnakeCase(fieldName);
}

/** Derives a PascalCase model name from an introspected table name, consulting `modelNames` overrides first. */
export function tableNameToModelName(
  tableName: string,
  modelNames: Readonly<Record<string, string>> = {},
): string {
  return modelNames[tableName] ?? toPascalCase(singularize(tableName));
}

/** Derives a client property key from an introspected table name. */
export function tableNameToClientKey(
  tableName: string,
  modelNames: Readonly<Record<string, string>> = {},
): string {
  return deriveClientKey(tableNameToModelName(tableName, modelNames));
}

/** Derives a camelCase TypeScript field name from an introspected SQL column name. */
export function columnNameToFieldName(columnName: string): string {
  return toCamelCase(columnName);
}
