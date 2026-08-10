import { FormBuilderError } from "./errors";
import type { FormControlElement } from "./types";

export function findForm(id: string, root: Document): HTMLFormElement {
  const candidate = root.getElementById(id);
  if (candidate === null || candidate.tagName !== "FORM") {
    throw new FormBuilderError(`form "#${id}" was not found.`);
  }
  return candidate as HTMLFormElement;
}

export function findNamedControls(form: HTMLFormElement, name: string): readonly FormControlElement[] {
  const controls: FormControlElement[] = [];
  for (const item of Array.from(form.elements)) {
    if (isFormControl(item) && item.name === name) controls.push(item);
  }
  if (controls.length === 0) throw new FormBuilderError(`field "${name}" was not found in form "#${form.id}".`);
  return Object.freeze(controls);
}

export function findErrorElement(form: HTMLFormElement, name: string): HTMLElement | undefined {
  for (const item of Array.from(form.querySelectorAll<HTMLElement>("[data-wbr-error-for]"))) {
    if (item.getAttribute("data-wbr-error-for") === name) return item;
  }
  return undefined;
}

export function findFormErrorElement(form: HTMLFormElement): HTMLElement | undefined {
  return form.querySelector<HTMLElement>("[data-wbr-form-errors]") ?? undefined;
}

function isFormControl(value: Element): value is FormControlElement {
  return value.tagName === "INPUT" || value.tagName === "SELECT" || value.tagName === "TEXTAREA";
}

export function safeDomId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, "-");
}
