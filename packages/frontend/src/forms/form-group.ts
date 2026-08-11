import { signal, type Signal } from "../signals";
import { findFormErrorElement } from "./dom";
import { FormBuilderError } from "./errors";
import { isIntentionalAbort, SubmissionRequestOwner } from "./request-owner";
import { FormControl } from "./form-control";
import { synchronizeBooleanState, synchronizeStatus } from "./state";
import { createFetchSubmission, normalizeServerErrors } from "./submit";
import { CleanupRegistry, once } from "./lifecycle";
import type { FormApi, FormStatus, FormValidator, FormValue } from "./types";

type Controls<T extends Readonly<Record<string, FormValue>>> = { readonly [K in keyof T]: FormControl<T[K]> };

export class FormGroup<T extends Readonly<Record<string, FormValue>>> implements FormApi<T> {
  public readonly value: Signal<T>;
  public readonly status = signal<FormStatus>("valid");
  public readonly touched = signal(false);
  public readonly dirty = signal(false);
  public readonly submitted = signal(false);
  public readonly submitting = signal(false);
  readonly #controls: Record<string, FormControl<FormValue>>;
  #validators: readonly FormValidator<T>[];
  #fetch: typeof globalThis.fetch | undefined;
  #formErrorElement: HTMLElement | undefined;
  readonly #originalFormErrorText: string | undefined;
  readonly #changeCallbacks = new Set<(value: T) => void>();
  readonly #submitCallbacks = new Set<(value: T) => void>();
  readonly #successCallbacks = new Set<(response: Response) => void>();
  readonly #errorCallbacks = new Set<(error: unknown) => void>();
  #formError: string | undefined;
  #validationFormError: string | undefined;
  #lastChange: string;
  #destroyed = false;
  readonly #submitListener: EventListener;
  readonly #invalidListener: EventListener;
  readonly #lifecycle = new CleanupRegistry();
  readonly #requests = new SubmissionRequestOwner();

  public constructor(
    public readonly element: HTMLFormElement,
    controls: Controls<T>,
    validators: readonly FormValidator<T>[],
    fetchImplementation: typeof globalThis.fetch,
    onDestroy: () => void,
  ) {
    this.#controls = controls as unknown as Record<string, FormControl<FormValue>>;
    this.#validators = validators;
    this.#fetch = fetchImplementation;
    this.#formErrorElement = findFormErrorElement(element);
    this.#originalFormErrorText = this.#formErrorElement?.textContent ?? undefined;
    this.value = signal(this.#readValue());
    this.#lastChange = stableValue(this.value());
    for (const control of Object.values(this.#controls) as FormControl<FormValue>[]) {
      control.setMutationCallback(() => this.#mutated());
    }
    this.#submitListener = (event) => { void this.#submit(event as SubmitEvent); };
    this.#invalidListener = () => { this.submitted.set(true); synchronizeBooleanState(this.element, "data-wbr-submitted", true); this.markAsTouched(); this.validate(); };
    element.addEventListener("submit", this.#submitListener);
    element.addEventListener("invalid", this.#invalidListener, true);
    this.#lifecycle.add(() => element.removeEventListener("submit", this.#submitListener));
    this.#lifecycle.add(() => element.removeEventListener("invalid", this.#invalidListener, true));
    this.#lifecycle.add(() => this.#requests.destroy());
    this.#lifecycle.add(onDestroy);
    for (const control of this.#values()) this.#lifecycle.add(() => control.destroy());
    this.validate(false);
  }

  public valid = (): boolean => this.status() === "valid";
  public invalid = (): boolean => this.status() === "invalid";
  public field<K extends keyof T & string>(name: K): FormControl<T[K]> {
    this.#assertActive();
    const control = this.#controls[name];
    if (control === undefined) throw new FormBuilderError(`field "${name}" is not registered.`);
    return control as unknown as FormControl<T[K]>;
  }
  public setValue(value: T): void {
    this.#assertActive();
    const expected = Object.keys(this.#controls);
    const received = Object.keys(value);
    if (expected.length !== received.length || expected.some((name) => !Object.hasOwn(value, name))) {
      throw new FormBuilderError("setValue() requires every registered field and no unknown fields.");
    }
    this.patchValue(value);
  }
  public patchValue(value: Partial<T>): void {
    this.#assertActive();
    for (const key of Object.keys(value) as (keyof T & string)[]) {
      const control = this.#controls[key];
      if (control === undefined) throw new FormBuilderError(`patchValue() received unknown field "${key}".`);
      const next = value[key];
      if (next !== undefined) control.setValue(next as FormValue);
    }
    this.#mutated();
  }
  public setError(message: string): void { this.#assertActive(); this.#formError = message; this.#renderFormError(); this.#synchronizeStatus("invalid"); }
  public clearError(): void { this.#assertActive(); this.#formError = undefined; this.#renderFormError(); this.validate(); }
  public markAsTouched(): void { this.#assertActive(); for (const control of this.#values()) control.markAsTouched(); this.#syncInteraction(); }
  public markAsUntouched(): void { this.#assertActive(); for (const control of this.#values()) control.markAsUntouched(); this.#syncInteraction(); }
  public markAsDirty(): void { this.#assertActive(); for (const control of this.#values()) control.markAsDirty(); this.#syncInteraction(); }
  public markAsPristine(): void { this.#assertActive(); for (const control of this.#values()) control.markAsPristine(); this.#syncInteraction(); }

  public validate(showErrors = this.submitted() || this.touched()): boolean {
    this.#assertActive();
    this.#validationFormError = undefined;
    for (const control of this.#values()) control.setFormErrors(Object.freeze([]));
    let valid = this.#values().every((control) => control.validate(showErrors));
    const issues = new Map<keyof T & string, string[]>();
    for (const validator of this.#validators) {
      const issue = validator.validate(this.#readValue());
      if (issue === null) continue;
      valid = false;
      if (issue.field === undefined) this.#validationFormError = issue.message;
      else {
        const key = issue.field as keyof T & string;
        const messages = issues.get(key) ?? [];
        messages.push(issue.message); issues.set(key, messages);
      }
    }
    for (const [key, messages] of issues) this.#controls[key]?.setFormErrors(Object.freeze(messages));
    if (this.#formError !== undefined || this.#validationFormError !== undefined) valid = false;
    this.#synchronizeStatus(valid ? "valid" : "invalid");
    this.#renderFormError();
    return valid;
  }
  public onChange(callback: (value: T) => void): () => void { this.#assertActive(); return subscribe(this.#changeCallbacks, callback); }
  public onSubmit(callback: (value: T) => void): () => void { this.#assertActive(); return subscribe(this.#submitCallbacks, callback); }
  public onSuccess(callback: (response: Response) => void): () => void { this.#assertActive(); return subscribe(this.#successCallbacks, callback); }
  public onError(callback: (error: unknown) => void): () => void { this.#assertActive(); return subscribe(this.#errorCallbacks, callback); }
  public destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#lifecycle.destroy();
    this.#changeCallbacks.clear(); this.#submitCallbacks.clear(); this.#successCallbacks.clear(); this.#errorCallbacks.clear();
    this.#validators = Object.freeze([]);
    this.#fetch = undefined;
    for (const key of Object.keys(this.#controls)) delete this.#controls[key];
    this.#formError = undefined; this.#validationFormError = undefined;
    for (const name of ["data-wbr-valid", "data-wbr-invalid", "data-wbr-pending", "data-wbr-touched", "data-wbr-dirty", "data-wbr-submitted", "data-wbr-submitting"]) this.element.removeAttribute(name);
    if (this.#formErrorElement !== undefined) this.#formErrorElement.textContent = this.#originalFormErrorText ?? "";
    this.#formErrorElement = undefined;
  }

  #mutated(): void {
    if (this.#destroyed) return;
    this.clearErrorWithoutValidation();
    const next = this.#readValue();
    this.value.set(next);
    this.validate();
    this.#syncInteraction();
    const serialized = stableValue(next);
    if (serialized !== this.#lastChange) {
      this.#lastChange = serialized;
      for (const callback of this.#changeCallbacks) callback(next);
    }
  }
  async #submit(event: SubmitEvent): Promise<void> {
    if (this.#destroyed) { event.preventDefault(); return; }
    const submitsNatively = this.element.hasAttribute("action");
    this.submitted.set(true);
    synchronizeBooleanState(this.element, "data-wbr-submitted", true);
    if (this.submitting()) { event.preventDefault(); return; }
    this.markAsTouched();
    if (!this.validate(true)) { event.preventDefault(); this.element.reportValidity(); return; }
    const current = this.#readValue();
    for (const callback of this.#submitCallbacks) callback(current);
    if (submitsNatively) return;
    event.preventDefault();
    this.submitting.set(true); synchronizeBooleanState(this.element, "data-wbr-submitting", true);
    const controller = this.#requests.begin();
    try {
      const request = createFetchSubmission(this.element, globalThis.location.href);
      const fetchImplementation = this.#fetch;
      if (fetchImplementation === undefined) return;
      const response = await fetchImplementation(request.url, { ...request.init, signal: controller.signal });
      if (!this.#requests.owns(controller)) return;
      if (!response.ok) {
        await this.#mapResponseErrors(response);
        if (!this.#requests.owns(controller)) return;
        const failure = new Error(`Form submission failed with HTTP ${response.status}.`);
        for (const callback of this.#errorCallbacks) callback(failure);
        return;
      }
      for (const callback of this.#successCallbacks) callback(response);
    } catch (error) {
      if (this.#requests.owns(controller) && !isIntentionalAbort(error)) {
        for (const callback of this.#errorCallbacks) callback(error);
      }
    } finally {
      if (this.#requests.finish(controller) && !this.#destroyed) {
        this.submitting.set(false); synchronizeBooleanState(this.element, "data-wbr-submitting", false);
      }
    }
  }
  async #mapResponseErrors(response: Response): Promise<void> {
    if (this.#destroyed) return;
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) return;
    let body: unknown;
    try { body = await response.clone().json(); } catch { return; }
    if (this.#destroyed) return;
    const normalized = normalizeServerErrors(body);
    for (const [name, message] of Object.entries(normalized.fields)) {
      const control = this.#controls[name];
      if (control !== undefined) control.setError(message);
    }
    if (normalized.message !== undefined) this.setError(normalized.message);
    this.markAsTouched();
    this.validate(true);
  }
  #readValue(): T {
    const output: Record<string, FormValue> = Object.create(null);
    for (const [name, control] of Object.entries(this.#controls) as [string, FormControl<FormValue>][]) output[name] = control.value();
    return Object.freeze(output) as T;
  }
  #values(): readonly FormControl<FormValue>[] { return Object.values(this.#controls); }
  #syncInteraction(): void {
    const touched = this.#values().some((control) => control.touched());
    const dirty = this.#values().some((control) => control.dirty());
    this.touched.set(touched); this.dirty.set(dirty);
    synchronizeBooleanState(this.element, "data-wbr-touched", touched);
    synchronizeBooleanState(this.element, "data-wbr-dirty", dirty);
  }
  #synchronizeStatus(status: FormStatus): void { this.status.set(status); synchronizeStatus(this.element, status); }
  #renderFormError(): void {
    if (this.#formErrorElement !== undefined) {
      this.#formErrorElement.textContent = this.#formError ??
        ((this.submitted() || this.touched()) ? this.#validationFormError ?? "" : "");
    }
  }
  private clearErrorWithoutValidation(): void { this.#formError = undefined; this.#renderFormError(); }
  #assertActive(): void { if (this.#destroyed) throw new FormBuilderError(`form "#${this.element.id}" has been destroyed.`); }
}

function subscribe<T>(callbacks: Set<T>, callback: T): () => void { callbacks.add(callback); return once(() => { callbacks.delete(callback); }); }
function stableValue(value: Readonly<Record<string, FormValue>>): string {
  return JSON.stringify(value, (_key, item: unknown) => item instanceof File ? Object.freeze({ name: item.name, size: item.size, type: item.type }) : item);
}
