import { createApp } from "@warbler/core";
import { AuthGraph } from "./graphs/auth/auth.graph";

export default createApp({
  graphs: [
    AuthGraph
  ],
});
