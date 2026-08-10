export function queryParam(name: string, url = location.href): string | null { return new URL(url).searchParams.get(name); }
export function queryParams(url = location.href): URLSearchParams { return new URL(url).searchParams; }
