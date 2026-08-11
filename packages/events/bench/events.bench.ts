import { EventDispatcher, event, listen, type EventRuntimeBindings } from "../src";

const Example = event((id: string) => ({ id } as const));
const first = listen(Example, () => {});
const second = listen(Example, () => {});
const bindings: EventRuntimeBindings = Object.freeze({
  events: Object.freeze([Object.freeze({ id: 0, event: Example })]),
  listeners: Object.freeze([
    Object.freeze({ id: 0, eventId: 0, listener: first }),
    Object.freeze({ id: 1, eventId: 0, listener: second }),
  ]),
  eventListeners: Object.freeze([Object.freeze([0, 1])]),
  interceptors: Object.freeze([]),
});
const dispatcher = new EventDispatcher(bindings);

const samples = 100_000;
const directStart = performance.now();
for (let index = 0; index < samples; index++) first.handle(Example("1"));
const directMs = performance.now() - directStart;

const dispatchStart = performance.now();
for (let index = 0; index < samples; index++) dispatcher.dispatch(Example("1"));
const dispatchMs = performance.now() - dispatchStart;

console.table([
  { name: "direct function", samples, totalMs: directMs, nsPerOp: (directMs * 1_000_000) / samples },
  { name: "dispatch two sync listeners", samples, totalMs: dispatchMs, nsPerOp: (dispatchMs * 1_000_000) / samples },
]);
