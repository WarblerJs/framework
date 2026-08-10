type Observer = {
  readonly dependencies: Set<Dependency>;
  disposed: boolean;
  notify(): void;
};
type Dependency = Set<Observer>;

let activeObserver: Observer | undefined;

export type Signal<T> = {
  (): T;
  set(value: T): void;
  update(updater: (value: T) => T): void;
};

export type Computed<T> = (() => T) & { dispose(): void };

function track(dependency: Dependency): void {
  const observer = activeObserver;
  if (observer === undefined || observer.disposed || dependency.has(observer)) return;
  dependency.add(observer);
  observer.dependencies.add(dependency);
}

function detach(observer: Observer): void {
  for (const dependency of observer.dependencies) dependency.delete(observer);
  observer.dependencies.clear();
}

function publish(dependency: Dependency): void {
  for (const observer of [...dependency]) if (!observer.disposed) observer.notify();
}

/** Creates a writable reactive value with removable subscribers. */
export function signal<T>(initialValue: T): Signal<T> {
  let value = initialValue;
  const subscribers: Dependency = new Set();
  const read = (() => { track(subscribers); return value; }) as Signal<T>;
  read.set = (nextValue: T) => {
    if (Object.is(value, nextValue)) return;
    value = nextValue;
    publish(subscribers);
  };
  read.update = (updater) => read.set(updater(value));
  return read;
}

/** Creates a lazy derived value. Call dispose() when its owner is destroyed. */
export function computed<T>(compute: () => T): Computed<T> {
  let value: T;
  let initialized = false;
  let dirty = true;
  const subscribers: Dependency = new Set();
  const observer: Observer = {
    dependencies: new Set(),
    disposed: false,
    notify() {
      if (dirty || observer.disposed) return;
      dirty = true;
      publish(subscribers);
    },
  };
  const read = (() => {
    track(subscribers);
    if (!initialized || dirty) {
      detach(observer);
      const previous = activeObserver;
      activeObserver = observer;
      try { value = compute(); initialized = true; dirty = false; }
      finally { activeObserver = previous; }
    }
    return value;
  }) as Computed<T>;
  read.dispose = () => {
    if (observer.disposed) return;
    observer.disposed = true;
    detach(observer);
    subscribers.clear();
  };
  return read;
}

/** Runs a reactive effect and returns an idempotent dependency-detaching cleanup. */
export function effect(callback: () => void): () => void {
  const observer: Observer = {
    dependencies: new Set(),
    disposed: false,
    notify: () => run(),
  };
  const run = (): void => {
    if (observer.disposed) return;
    detach(observer);
    const previous = activeObserver;
    activeObserver = observer;
    try { callback(); }
    finally { activeObserver = previous; }
  };
  run();
  return () => {
    if (observer.disposed) return;
    observer.disposed = true;
    detach(observer);
  };
}
