import { createApp, Transport } from "@warbler/framework";

export default createApp({
  transports: [
    Transport.HTTP,
    Transport.WEBSOCKET,
  ],

  graphs: "src/graphs/**/*.graph.ts",
});
