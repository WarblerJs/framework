import { Email } from "../src";
import { MemoryTransport } from "../src/testing";

const renderer = Object.freeze({ render: () => "<p>Hello</p>" });

export async function runMemoryTransportBench(iterations = 1000): Promise<{ readonly iterations: number; readonly ms: number }> {
  const transport = new MemoryTransport();
  const email = new Email({ transport: "memory" }, renderer, transport);
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    await email.send({ to: "user@example.test", subject: "Hello", text: "Hello" });
  }
  return Object.freeze({ iterations, ms: performance.now() - started });
}

if (import.meta.main) console.log(await runMemoryTransportBench());
