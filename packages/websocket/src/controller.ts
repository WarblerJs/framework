/** Constructor accepted by WebSocket metadata APIs. */
export type SocketControllerType = abstract new (...arguments_: never[]) => object;
/** Metadata identifying a WebSocket controller. */
export interface SocketControllerMetadata { readonly controller: true }

const controllers = new WeakMap<Function, SocketControllerMetadata>();

/** Marks a class as a WebSocket controller without instantiating it. */
export function SocketController(): ClassDecorator {
  return (target): void => { controllers.set(target, Object.freeze({ controller: true })); };
}

/** Reads immutable controller metadata during compilation/bootstrap. */
export function getSocketControllerMetadata(target: Function): SocketControllerMetadata | undefined {
  return controllers.get(target);
}
