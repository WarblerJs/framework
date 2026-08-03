export function freezeDeep<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  const entries = Object.values(value);
  for (const entry of entries) freezeDeep(entry);
  return Object.freeze(value);
}
