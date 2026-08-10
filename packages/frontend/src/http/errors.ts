export class HttpError extends Error {
  constructor(public readonly status: number, public readonly statusText: string, public readonly response: Response) {
    super(`HTTP ${status}: ${statusText}`);
    this.name = "HttpError";
  }
}
