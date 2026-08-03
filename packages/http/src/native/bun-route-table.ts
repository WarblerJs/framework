import type { HttpMethodValue } from "../route";
import type { BunRouteHandler } from "./bun-route-handler";

/** Method-specific values accepted by a generated Bun route. */
export type BunMethodRouteTable = Partial<Record<HttpMethodValue, BunRouteHandler | Response>>;

/** Generated route values passed directly to Bun's native router. */
export type BunRouteTable = Readonly<Record<string, BunMethodRouteTable | BunRouteHandler | Response | Bun.BunFile | false>>;
