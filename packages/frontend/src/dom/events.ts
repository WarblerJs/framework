export function on<K extends keyof HTMLElementEventMap>(target: EventTarget, event: K, listener: (event: HTMLElementEventMap[K]) => void): () => void {
  const fn = listener as EventListener;
  target.addEventListener(event, fn);
  return () => target.removeEventListener(event, fn);
}
