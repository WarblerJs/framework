import { SQL } from "bun";
import type { PgConnectionConfig } from "../types/config.types";

/** Builds a Bun `SQL` connection from a project's `databaseConfig.pg.connection`. The one place connection options are mapped, shared by generated `runtime/pg-client.ts` and the CLI's `db:pg` commands. */
export function createPgConnection(connection: PgConnectionConfig): SQL {
  return new SQL({
    ...(connection.adapter === undefined ? {} : { adapter: connection.adapter }),
    ...(connection.url !== undefined && connection.url.length > 0 ? { url: connection.url } : {}),
    ...(connection.hostname === undefined ? {} : { hostname: connection.hostname }),
    ...(connection.port === undefined ? {} : { port: connection.port }),
    ...(connection.database === undefined ? {} : { database: connection.database }),
    ...(connection.username === undefined ? {} : { username: connection.username }),
    ...(connection.password === undefined ? {} : { password: connection.password }),
    ...(connection.ssl === undefined ? {} : { ssl: connection.ssl }),
    ...(connection.max === undefined ? {} : { max: connection.max }),
    ...(connection.idleTimeout === undefined ? {} : { idleTimeout: connection.idleTimeout }),
    ...(connection.connectionTimeout === undefined ? {} : { connectionTimeout: connection.connectionTimeout }),
  });
}
