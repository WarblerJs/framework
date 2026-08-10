export const storage = {
  get<T = string>(key: string): T | null { const value = localStorage.getItem(key); if (value === null) return null; try { return JSON.parse(value) as T; } catch { return value as T; } },
  set(key: string, value: unknown): void { localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value)); },
  remove(key: string): void { localStorage.removeItem(key); },
  clear(): void { localStorage.clear(); }
};
