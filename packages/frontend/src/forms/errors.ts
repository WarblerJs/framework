/** Base browser-side Forms failure. */
export class FormBuilderError extends Error {
  public constructor(message: string) {
    super(`Warbler FormBuilder: ${message}`);
    this.name = "FormBuilderError";
  }
}
