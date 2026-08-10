export interface HttpOptions extends Omit<RequestInit, "method" | "body"> { body?: unknown; }
