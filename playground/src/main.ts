import { createApp, Transport } from "@warblerjs/framework";

export default createApp({
  transports: [
    Transport.HTTP,
    Transport.WEBSOCKET,
  ],

  graphs: "src/graphs/**/*.graph.ts",
});
