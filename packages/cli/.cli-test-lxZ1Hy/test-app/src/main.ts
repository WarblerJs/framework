import { createApp, Transport } from "@warblerjs/framework";

export default createApp({
  transports: [Transport.HTTP],
  graphs: "src/graphs/**/*.graph.ts",
});
