import { httpConfig } from "./http.config";
import { mcpConfig } from "./mcp.config";
import { tcpConfig } from "./tcp.config";
import { udpConfig } from "./udp.config";
import { webrtcConfig } from "./webrtc.config";
import { wsConfig } from "./ws.config";

export const transporterConfig = {
    http: httpConfig,
    websocket: wsConfig,
    tcp: tcpConfig,
    udp: udpConfig,
    webrtc: webrtcConfig,
    mcp: mcpConfig,
  } as const;
  
  // Export individual types cleanly for your protocol engines
  export type TransporterConfig = typeof transporterConfig;