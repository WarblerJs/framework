export function serializeForm(target: string | HTMLFormElement): Record<string, FormDataEntryValue> {
  const form = typeof target === "string" ? document.querySelector<HTMLFormElement>(target) : target;
  if (!form) throw new Error("Form not found");
  return Object.fromEntries(new FormData(form).entries());
}
export const form = { serialize: serializeForm };
