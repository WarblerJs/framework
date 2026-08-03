/** Raised when graph metadata is invalid. */
export class GraphDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphDefinitionError";
  }
}
