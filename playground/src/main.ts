import { createApp, Transport } from "@warbler/core";

export default createApp({
  transports: [
    Transport.HTTP,
    Transport.WEBSOCKET,
  ],

  graphs: "src/graphs/**/*.graph.ts",
});
