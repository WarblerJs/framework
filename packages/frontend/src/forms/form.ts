import { findForm, findNamedControls } from "./dom";
import { FormControl } from "./form-control";
import { FormGroup } from "./form-group";
import type { FieldDefinitions, FormBuilderOptions, FormValue, InferFormValue } from "./types";
import { validators } from "./validators";
import { InstanceRegistry } from "./lifecycle";

const owners = new InstanceRegistry<HTMLFormElement, FormGroup<Readonly<Record<string, FormValue>>>>();

/**
 * Enhances one native form with typed values, validation, state attributes, and submission.
 * Reinitializing the same element destroys the previous Warbler-owned listeners first.
 */
export function FormBuilder<const D extends FieldDefinitions>(
  formId: string,
  definition: (validators: typeof import("./validators").validators) => D,
  options: FormBuilderOptions<InferFormValue<D>> = {},
): FormGroup<InferFormValue<D>> {
  if (typeof document === "undefined") throw new Error("Warbler FormBuilder requires a browser document.");
  const form = findForm(formId, document);
  return owners.replace(form, () => {
    const declared = definition(validators);
    const controls: Record<string, FormControl<FormValue>> = Object.create(null);
    try {
      for (const [name, item] of Object.entries(declared)) {
        const [initial, ...rules] = item;
        controls[name] = new FormControl(name, form, findNamedControls(form, name), initial, rules);
      }
    } catch (error) {
      for (const control of Object.values(controls)) control.destroy();
      throw error;
    }
    const configured = typeof options.validators === "function" ? options.validators(validators) : options.validators ?? Object.freeze([]);
    let group: FormGroup<InferFormValue<D>>;
    try {
      group = new FormGroup(
        form,
        controls as never,
        configured,
        options.fetch ?? globalThis.fetch.bind(globalThis),
        () => owners.release(form, group as unknown as FormGroup<Readonly<Record<string, FormValue>>>),
      );
    } catch (error) {
      for (const control of Object.values(controls)) control.destroy();
      throw error;
    }
    return group as unknown as FormGroup<Readonly<Record<string, FormValue>>>;
  }) as unknown as FormGroup<InferFormValue<D>>;
}
