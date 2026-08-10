export function throttle<T extends (...args: never[]) => void>(fn: T, wait: number): (...args: Parameters<T>) => void {
  let ready = true;
  return (...args: Parameters<T>) => { if (!ready) return; ready = false; fn(...args); setTimeout(() => { ready = true; }, wait); };
}
