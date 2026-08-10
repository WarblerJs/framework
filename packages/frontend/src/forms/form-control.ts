import { signal, type Signal } from "../signals";
import { findErrorElement, safeDomId } from "./dom";
import { synchronizeBooleanState, synchronizeStatus } from "./state";
import { CleanupRegistry, once } from "./lifecycle";
import { FormBuilderError } from "./errors";
import type { FieldApi, FieldValidator, FormControlElement, FormStatus, FormValue } from "./types";

export class FormControl<T extends FormValue> implements FieldApi<T> {
  public readonly element: FormControlElement;
  public readonly elements: readonly FormControlElement[];
  public readonly value: Signal<T>;
  public readonly status = signal<FormStatus>("valid");
  public readonly touched = signal(false);
  public readonly dirty = signal(false);
  public readonly errors = signal<readonly string[]>(Object.freeze([]));
  readonly #initial: T;
  #validators: readonly FieldValidator<T>[];
  #errorElement: HTMLElement | undefined;
  readonly #lifecycle = new CleanupRegistry();
  readonly #originalAttributes = new Map<FormControlElement, Map<string, string | null>>();
  readonly #inputCallbacks = new Set<(value: T) => void>();
  readonly #changeCallbacks = new Set<(value: T) => void>();
  readonly #focusCallbacks = new Set<() => void>();
  readonly #blurCallbacks = new Set<() => void>();
  #externalError: string | undefined;
  #formErrors: readonly string[] = Object.freeze([]);
  #showErrors = false;
  #onMutation: () => void = () => {};
  readonly #originalErrorText: string | undefined;
  readonly #errorHadId: boolean;

  public constructor(
    readonly name: string,
    form: HTMLFormElement,
    elements: readonly FormControlElement[],
    initial: T,
    validators: readonly FieldValidator<T>[],
  ) {
    this.element = elements[0]!;
    this.elements = elements;
    this.#initial = initial;
    this.#validators = validators;
    this.#errorElement = findErrorElement(form, name);
    this.#originalErrorText = this.#errorElement?.textContent ?? undefined;
    this.#errorHadId = (this.#errorElement?.id.length ?? 0) > 0;
    this.#prepareAccessibility(form.id);
    this.#applyConstraints();
    this.#write(initial);
    this.value = signal(initial);
    this.#listen();
    this.validate(false);
  }

  public valid = (): boolean => this.status() === "valid";
  public invalid = (): boolean => this.status() === "invalid";
  public setMutationCallback(callback: () => void): void { this.#assertActive(); this.#onMutation = callback; }

  public setValue(value: T): void {
    this.#assertActive();
    this.#externalError = undefined;
    this.#write(value);
    this.value.set(value);
    this.#synchronizeDirty();
    this.#onMutation();
  }
  public setError(message: string): void { this.#assertActive(); this.#externalError = message; this.validate(true); this.#onMutation(); }
  public clearError(): void { this.#assertActive(); this.#externalError = undefined; this.validate(this.#showErrors); this.#onMutation(); }
  public setFormErrors(errors: readonly string[]): void { if (this.#lifecycle.destroyed) return; this.#formErrors = errors; this.validate(this.#showErrors); }
  public markAsTouched(): void { this.#assertActive(); this.touched.set(true); for (const element of this.elements) synchronizeBooleanState(element, "data-wbr-touched", true); this.#showErrors = true; this.#renderErrors(); }
  public markAsUntouched(): void { this.#assertActive(); this.touched.set(false); for (const element of this.elements) synchronizeBooleanState(element, "data-wbr-touched", false); this.#showErrors = false; this.#renderErrors(); }
  public markAsDirty(): void { this.#assertActive(); this.dirty.set(true); for (const element of this.elements) synchronizeBooleanState(element, "data-wbr-dirty", true); }
  public markAsPristine(): void { this.#assertActive(); this.dirty.set(false); for (const element of this.elements) synchronizeBooleanState(element, "data-wbr-dirty", false); }

  public validate(showErrors = this.#showErrors): boolean {
    this.#assertActive();
    this.#showErrors = showErrors;
    for (const element of this.elements) element.setCustomValidity("");
    const messages: string[] = [];
    for (const validator of this.#validators) if (!validator.validate(this.value())) messages.push(validator.message);
    if (messages.length === 0) {
      for (const element of this.elements) {
        if (!element.checkValidity()) { messages.push(element.validationMessage); break; }
      }
    }
    messages.push(...this.#formErrors);
    if (this.#externalError !== undefined) messages.push(this.#externalError);
    const unique = Object.freeze([...new Set(messages.filter((message) => message.length > 0))]);
    this.errors.set(unique);
    const status: FormStatus = unique.length === 0 ? "valid" : "invalid";
    this.status.set(status);
    for (const element of this.elements) {
      synchronizeStatus(element, status);
      if (status === "invalid") element.setAttribute("aria-invalid", "true");
      else element.removeAttribute("aria-invalid");
    }
    this.#renderErrors();
    return status === "valid";
  }

  public onInput(callback: (value: T) => void): () => void { this.#assertActive(); return subscribe(this.#inputCallbacks, callback); }
  public onChange(callback: (value: T) => void): () => void { this.#assertActive(); return subscribe(this.#changeCallbacks, callback); }
  public onFocus(callback: () => void): () => void { this.#assertActive(); return subscribe(this.#focusCallbacks, callback); }
  public onBlur(callback: () => void): () => void { this.#assertActive(); return subscribe(this.#blurCallbacks, callback); }
  public destroy(): void {
    if (this.#lifecycle.destroyed) return;
    this.#lifecycle.destroy();
    this.#inputCallbacks.clear(); this.#changeCallbacks.clear(); this.#focusCallbacks.clear(); this.#blurCallbacks.clear();
    this.#externalError = undefined; this.#formErrors = Object.freeze([]); this.#onMutation = () => {};
    this.#validators = Object.freeze([]);
    for (const element of this.elements) {
      for (const name of ["data-wbr-valid", "data-wbr-invalid", "data-wbr-pending", "data-wbr-touched", "data-wbr-dirty"]) element.removeAttribute(name);
      this.#restoreAttributes(element);
    }
    if (this.#errorElement !== undefined) {
      this.#errorElement.textContent = this.#originalErrorText ?? "";
      if (!this.#errorHadId) this.#errorElement.removeAttribute("id");
    }
    this.#errorElement = undefined;
    this.#originalAttributes.clear();
  }

  #listen(): void {
    for (const element of this.elements) {
      this.#add(element, "input", () => this.#handleValue(this.#inputCallbacks));
      this.#add(element, "change", () => this.#handleValue(this.#changeCallbacks));
      this.#add(element, "focus", () => { for (const callback of this.#focusCallbacks) callback(); });
      this.#add(element, "blur", () => { this.markAsTouched(); this.validate(true); for (const callback of this.#blurCallbacks) callback(); });
    }
  }
  #add(element: EventTarget, type: string, callback: EventListener): void {
    element.addEventListener(type, callback);
    this.#lifecycle.add(() => element.removeEventListener(type, callback));
  }
  #handleValue(callbacks: ReadonlySet<(value: T) => void>): void {
    if (this.#lifecycle.destroyed) return;
    this.#externalError = undefined;
    const value = this.#read();
    this.value.set(value);
    this.#synchronizeDirty();
    for (const callback of callbacks) callback(value);
    this.#onMutation();
  }
  #synchronizeDirty(): void {
    const dirty = !equalValue(this.value(), this.#initial);
    this.dirty.set(dirty);
    for (const element of this.elements) synchronizeBooleanState(element, "data-wbr-dirty", dirty);
  }
  #applyConstraints(): void {
    for (const validator of this.#validators) {
      const constraint = validator.constraint;
      if (constraint === undefined) continue;
      for (const element of this.elements) {
        if (constraint.required) { this.#capture(element, "required"); element.required = true; }
        if (constraint.type !== undefined && element.tagName === "INPUT") { this.#capture(element, "type"); (element as HTMLInputElement).type = constraint.type; }
        if (constraint.minLength !== undefined && element.tagName !== "SELECT") { this.#capture(element, "minlength"); (element as HTMLInputElement | HTMLTextAreaElement).minLength = constraint.minLength; }
        if (constraint.maxLength !== undefined && element.tagName !== "SELECT") { this.#capture(element, "maxlength"); (element as HTMLInputElement | HTMLTextAreaElement).maxLength = constraint.maxLength; }
        if (constraint.min !== undefined && element.tagName === "INPUT") { this.#capture(element, "min"); (element as HTMLInputElement).min = String(constraint.min); }
        if (constraint.max !== undefined && element.tagName === "INPUT") { this.#capture(element, "max"); (element as HTMLInputElement).max = String(constraint.max); }
        if (constraint.pattern !== undefined && element.tagName === "INPUT") { this.#capture(element, "pattern"); (element as HTMLInputElement).pattern = constraint.pattern; }
      }
    }
  }
  #read(): T {
    const first = this.element;
    if (first.tagName === "INPUT") {
      const input = first as HTMLInputElement;
      if (input.type === "radio") return (this.elements.find((item) => (item as HTMLInputElement).checked)?.value ?? "") as T;
      if (input.type === "checkbox") {
        if (Array.isArray(this.#initial)) return this.elements.filter((item) => (item as HTMLInputElement).checked).map((item) => item.value) as unknown as T;
        return input.checked as T;
      }
      if (input.type === "number" && typeof this.#initial === "number") return (Number.isNaN(input.valueAsNumber) ? 0 : input.valueAsNumber) as T;
    }
    return first.value as T;
  }
  #write(value: T): void {
    const first = this.element;
    if (first.tagName === "INPUT" && (first as HTMLInputElement).type === "radio") {
      for (const item of this.elements) (item as HTMLInputElement).checked = String(item.value) === String(value);
    } else if (first.tagName === "INPUT" && (first as HTMLInputElement).type === "checkbox") {
      for (const item of this.elements) (item as HTMLInputElement).checked = Array.isArray(value) ? value.map(String).includes(item.value) : Boolean(value);
    } else first.value = value === null ? "" : String(value);
  }
  #prepareAccessibility(formId: string): string | undefined {
    const error = this.#errorElement;
    if (error === undefined) return undefined;
    const id = error.id || `wbr-${safeDomId(formId)}-${safeDomId(this.name)}-error`;
    error.id = id;
    for (const element of this.elements) {
      this.#capture(element, "aria-describedby");
      this.#capture(element, "aria-invalid");
      const describedBy = new Set((element.getAttribute("aria-describedby") ?? "").split(/\s+/u).filter(Boolean));
      describedBy.add(id);
      element.setAttribute("aria-describedby", [...describedBy].join(" "));
    }
    return id;
  }
  #renderErrors(): void {
    if (this.#errorElement !== undefined) this.#errorElement.textContent = this.#showErrors ? this.errors()[0] ?? "" : "";
  }
  #capture(element: FormControlElement, name: string): void {
    let attributes = this.#originalAttributes.get(element);
    if (attributes === undefined) { attributes = new Map(); this.#originalAttributes.set(element, attributes); }
    if (!attributes.has(name)) attributes.set(name, element.getAttribute(name));
  }
  #restoreAttributes(element: FormControlElement): void {
    for (const [name, value] of this.#originalAttributes.get(element) ?? []) {
      if (value === null) element.removeAttribute(name); else element.setAttribute(name, value);
    }
  }
  #assertActive(): void {
    if (this.#lifecycle.destroyed) throw new FormBuilderError(`field "${this.name}" has been destroyed.`);
  }
}

function subscribe<T>(callbacks: Set<T>, callback: T): () => void { callbacks.add(callback); return once(() => { callbacks.delete(callback); }); }
function equalValue(left: FormValue, right: FormValue): boolean {
  return Array.isArray(left) && Array.isArray(right)
    ? left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
    : Object.is(left, right);
}
