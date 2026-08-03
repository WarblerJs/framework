import { ConfigError } from "../errors";

type ConfigModule = Readonly<Record<string, unknown>>;

export async function importConfig(path: string): Promise<ConfigModule> {
  try {
    return await import(path);
  } catch (error) {
    throw new ConfigError("configuration module could not be imported", path, { cause: error });
  }
}

export function selectExport(module: ConfigModule, names: readonly string[], path: string): unknown {
  if (module.default !== undefined) return module.default;
  for (const name of names) {
    if (module[name] !== undefined) return module[name];
  }
  throw new ConfigError(`must export default or one of: ${names.join(", ")}`, path);
}
