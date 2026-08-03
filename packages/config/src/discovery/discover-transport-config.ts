import type { TransportName } from "../types";
import { joinPath } from "../utils/path";
import { requireDirectory, requireFile } from "./discovery-utils";
import { discoverConfigFolder } from "./discover-config-folder";

const FILE_NAMES: Readonly<Record<TransportName, string>> = Object.freeze({
  http: "http.config.ts",
  websocket: "ws.config.ts",
  tcp: "tcp.config.ts",
  udp: "udp.config.ts",
  mcp: "mcp.config.ts",
  webrtc: "webrtc.config.ts",
});

/** Discovers and verifies an enabled transport's conventional configuration module. */
export async function discoverTransportConfig(
  transport: TransportName,
  workspaceRoot = process.cwd(),
): Promise<string> {
  const config = await discoverConfigFolder(workspaceRoot);
  const directory = await requireDirectory(joinPath(config, "transports"), "transport configuration directory");
  return requireFile(joinPath(directory, FILE_NAMES[transport]), `${transport} configuration`);
}
