import type { Container } from "./container";
import { MissingInjectionContextError } from "../errors";

let activeContainer: Container | undefined;

/** Executes a callback with an active dependency-injection container. */
export function runInInjectionContext<T>(container: Container, callback: () => T): T {
  const previous = activeContainer;
  activeContainer = container;
  try {
    return callback();
  } finally {
    activeContainer = previous;
  }
}

/** Returns the currently active dependency-injection container. */
export function getActiveContainer(): Container {
  if (!activeContainer) throw new MissingInjectionContextError();
  return activeContainer;
}
