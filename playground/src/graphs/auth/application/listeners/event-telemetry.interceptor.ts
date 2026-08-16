import { interceptEvent } from "@warbler/events";

export const eventTelemetry = interceptEvent(async (context, next) => {
  const start = performance.now();
  await next();
  context.log.debug("Event dispatched.", {
    eventId: context.eventId,
    duration: performance.now() - start,
  });
});
