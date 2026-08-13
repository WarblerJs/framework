import { createApp } from "@warbler/core";
import AuthGraph from "./graphs/auth/auth.graph";
import ChatGraph from "./graphs/chat/chat.graph";
import HomeGraph from "./graphs/home/home.graph";
import BenchGraph from "./graphs/bench/bench.graph";

export default createApp({
  graphs: [HomeGraph, AuthGraph, ChatGraph,BenchGraph],
});
