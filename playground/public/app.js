var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// ../packages/frontend/src/forms/serialize.ts
var init_serialize = () => {};

// ../packages/frontend/src/forms/errors.ts
var FormBuilderError;
var init_errors = __esm(() => {
  FormBuilderError = class FormBuilderError extends Error {
    constructor(message) {
      super(`Warbler FormBuilder: ${message}`);
      this.name = "FormBuilderError";
    }
  };
});

// ../packages/frontend/src/forms/dom.ts
function findForm(id, root) {
  const candidate = root.getElementById(id);
  if (candidate === null || candidate.tagName !== "FORM") {
    throw new FormBuilderError(`form "#${id}" was not found.`);
  }
  return candidate;
}
function findNamedControls(form, name) {
  const controls = [];
  for (const item of Array.from(form.elements)) {
    if (isFormControl(item) && item.name === name)
      controls.push(item);
  }
  if (controls.length === 0)
    throw new FormBuilderError(`field "${name}" was not found in form "#${form.id}".`);
  return Object.freeze(controls);
}
function findErrorElement(form, name) {
  for (const item of Array.from(form.querySelectorAll("[data-wbr-error-for]"))) {
    if (item.getAttribute("data-wbr-error-for") === name)
      return item;
  }
  return;
}
function findFormErrorElement(form) {
  return form.querySelector("[data-wbr-form-errors]") ?? undefined;
}
function isFormControl(value) {
  return value.tagName === "INPUT" || value.tagName === "SELECT" || value.tagName === "TEXTAREA";
}
function safeDomId(value) {
  return value.replace(/[^A-Za-z0-9_-]/gu, "-");
}
var init_dom = __esm(() => {
  init_errors();
});

// ../packages/frontend/src/signals/init.ts
function track(dependency) {
  const observer = activeObserver;
  if (observer === undefined || observer.disposed || dependency.has(observer))
    return;
  dependency.add(observer);
  observer.dependencies.add(dependency);
}
function publish(dependency) {
  for (const observer of [...dependency])
    if (!observer.disposed)
      observer.notify();
}
function signal(initialValue) {
  let value = initialValue;
  const subscribers = new Set;
  const read = () => {
    track(subscribers);
    return value;
  };
  read.set = (nextValue) => {
    if (Object.is(value, nextValue))
      return;
    value = nextValue;
    publish(subscribers);
  };
  read.update = (updater) => read.set(updater(value));
  return read;
}
var activeObserver;

// ../packages/frontend/src/signals/index.ts
var init_signals = () => {};

// ../packages/frontend/src/forms/state.ts
function synchronizeStatus(element, status) {
  element.removeAttribute("data-wbr-valid");
  element.removeAttribute("data-wbr-invalid");
  element.removeAttribute("data-wbr-pending");
  element.setAttribute(`data-wbr-${status}`, "");
}
function synchronizeBooleanState(element, name, enabled) {
  if (enabled)
    element.setAttribute(name, "");
  else
    element.removeAttribute(name);
}

// ../packages/frontend/src/forms/lifecycle.ts
class CleanupRegistry {
  #cleanups = [];
  #destroyed = false;
  get destroyed() {
    return this.#destroyed;
  }
  add(cleanup) {
    if (this.#destroyed) {
      safely(cleanup);
      return;
    }
    this.#cleanups.push(once(cleanup));
  }
  destroy() {
    if (this.#destroyed)
      return;
    this.#destroyed = true;
    for (const cleanup of this.#cleanups.splice(0).reverse())
      safely(cleanup);
  }
}

class InstanceRegistry {
  #instances = new WeakMap;
  replace(element, create) {
    this.#instances.get(element)?.destroy();
    const instance = create();
    this.#instances.set(element, instance);
    return instance;
  }
  release(element, instance) {
    if (this.#instances.get(element) === instance)
      this.#instances.delete(element);
  }
  get(element) {
    return this.#instances.get(element);
  }
}
function once(cleanup) {
  let active = true;
  return () => {
    if (!active)
      return;
    active = false;
    cleanup();
  };
}
function safely(cleanup) {
  try {
    cleanup();
  } catch {}
}

// ../packages/frontend/src/forms/form-control.ts
class FormControl {
  name;
  element;
  elements;
  value;
  status = signal("valid");
  touched = signal(false);
  dirty = signal(false);
  errors = signal(Object.freeze([]));
  #initial;
  #validators;
  #errorElement;
  #lifecycle = new CleanupRegistry;
  #originalAttributes = new Map;
  #inputCallbacks = new Set;
  #changeCallbacks = new Set;
  #focusCallbacks = new Set;
  #blurCallbacks = new Set;
  #externalError;
  #formErrors = Object.freeze([]);
  #showErrors = false;
  #onMutation = () => {};
  #originalErrorText;
  #errorHadId;
  constructor(name, form, elements, initial, validators) {
    this.name = name;
    this.element = elements[0];
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
  valid = () => this.status() === "valid";
  invalid = () => this.status() === "invalid";
  setMutationCallback(callback) {
    this.#assertActive();
    this.#onMutation = callback;
  }
  setValue(value) {
    this.#assertActive();
    this.#externalError = undefined;
    this.#write(value);
    this.value.set(value);
    this.#synchronizeDirty();
    this.#onMutation();
  }
  setError(message) {
    this.#assertActive();
    this.#externalError = message;
    this.validate(true);
    this.#onMutation();
  }
  clearError() {
    this.#assertActive();
    this.#externalError = undefined;
    this.validate(this.#showErrors);
    this.#onMutation();
  }
  setFormErrors(errors) {
    if (this.#lifecycle.destroyed)
      return;
    this.#formErrors = errors;
    this.validate(this.#showErrors);
  }
  markAsTouched() {
    this.#assertActive();
    this.touched.set(true);
    for (const element of this.elements)
      synchronizeBooleanState(element, "data-wbr-touched", true);
    this.#showErrors = true;
    this.#renderErrors();
  }
  markAsUntouched() {
    this.#assertActive();
    this.touched.set(false);
    for (const element of this.elements)
      synchronizeBooleanState(element, "data-wbr-touched", false);
    this.#showErrors = false;
    this.#renderErrors();
  }
  markAsDirty() {
    this.#assertActive();
    this.dirty.set(true);
    for (const element of this.elements)
      synchronizeBooleanState(element, "data-wbr-dirty", true);
  }
  markAsPristine() {
    this.#assertActive();
    this.dirty.set(false);
    for (const element of this.elements)
      synchronizeBooleanState(element, "data-wbr-dirty", false);
  }
  validate(showErrors = this.#showErrors) {
    this.#assertActive();
    this.#showErrors = showErrors;
    for (const element of this.elements)
      element.setCustomValidity("");
    const messages = [];
    for (const validator of this.#validators)
      if (!validator.validate(this.value()))
        messages.push(validator.message);
    if (messages.length === 0) {
      for (const element of this.elements) {
        if (!element.checkValidity()) {
          messages.push(element.validationMessage);
          break;
        }
      }
    }
    messages.push(...this.#formErrors);
    if (this.#externalError !== undefined)
      messages.push(this.#externalError);
    const unique = Object.freeze([...new Set(messages.filter((message) => message.length > 0))]);
    this.errors.set(unique);
    const status = unique.length === 0 ? "valid" : "invalid";
    this.status.set(status);
    for (const element of this.elements) {
      synchronizeStatus(element, status);
      if (status === "invalid")
        element.setAttribute("aria-invalid", "true");
      else
        element.removeAttribute("aria-invalid");
    }
    this.#renderErrors();
    return status === "valid";
  }
  onInput(callback) {
    this.#assertActive();
    return subscribe(this.#inputCallbacks, callback);
  }
  onChange(callback) {
    this.#assertActive();
    return subscribe(this.#changeCallbacks, callback);
  }
  onFocus(callback) {
    this.#assertActive();
    return subscribe(this.#focusCallbacks, callback);
  }
  onBlur(callback) {
    this.#assertActive();
    return subscribe(this.#blurCallbacks, callback);
  }
  destroy() {
    if (this.#lifecycle.destroyed)
      return;
    this.#lifecycle.destroy();
    this.#inputCallbacks.clear();
    this.#changeCallbacks.clear();
    this.#focusCallbacks.clear();
    this.#blurCallbacks.clear();
    this.#externalError = undefined;
    this.#formErrors = Object.freeze([]);
    this.#onMutation = () => {};
    this.#validators = Object.freeze([]);
    for (const element of this.elements) {
      for (const name of ["data-wbr-valid", "data-wbr-invalid", "data-wbr-pending", "data-wbr-touched", "data-wbr-dirty"])
        element.removeAttribute(name);
      this.#restoreAttributes(element);
    }
    if (this.#errorElement !== undefined) {
      this.#errorElement.textContent = this.#originalErrorText ?? "";
      if (!this.#errorHadId)
        this.#errorElement.removeAttribute("id");
    }
    this.#errorElement = undefined;
    this.#originalAttributes.clear();
  }
  #listen() {
    for (const element of this.elements) {
      this.#add(element, "input", () => this.#handleValue(this.#inputCallbacks));
      this.#add(element, "change", () => this.#handleValue(this.#changeCallbacks));
      this.#add(element, "focus", () => {
        for (const callback of this.#focusCallbacks)
          callback();
      });
      this.#add(element, "blur", () => {
        this.markAsTouched();
        this.validate(true);
        for (const callback of this.#blurCallbacks)
          callback();
      });
    }
  }
  #add(element, type, callback) {
    element.addEventListener(type, callback);
    this.#lifecycle.add(() => element.removeEventListener(type, callback));
  }
  #handleValue(callbacks) {
    if (this.#lifecycle.destroyed)
      return;
    this.#externalError = undefined;
    const value = this.#read();
    this.value.set(value);
    this.#synchronizeDirty();
    for (const callback of callbacks)
      callback(value);
    this.#onMutation();
  }
  #synchronizeDirty() {
    const dirty = !equalValue(this.value(), this.#initial);
    this.dirty.set(dirty);
    for (const element of this.elements)
      synchronizeBooleanState(element, "data-wbr-dirty", dirty);
  }
  #applyConstraints() {
    for (const validator of this.#validators) {
      const constraint = validator.constraint;
      if (constraint === undefined)
        continue;
      for (const element of this.elements) {
        if (constraint.required) {
          this.#capture(element, "required");
          element.required = true;
        }
        if (constraint.type !== undefined && element.tagName === "INPUT") {
          this.#capture(element, "type");
          element.type = constraint.type;
        }
        if (constraint.minLength !== undefined && element.tagName !== "SELECT") {
          this.#capture(element, "minlength");
          element.minLength = constraint.minLength;
        }
        if (constraint.maxLength !== undefined && element.tagName !== "SELECT") {
          this.#capture(element, "maxlength");
          element.maxLength = constraint.maxLength;
        }
        if (constraint.min !== undefined && element.tagName === "INPUT") {
          this.#capture(element, "min");
          element.min = String(constraint.min);
        }
        if (constraint.max !== undefined && element.tagName === "INPUT") {
          this.#capture(element, "max");
          element.max = String(constraint.max);
        }
        if (constraint.pattern !== undefined && element.tagName === "INPUT") {
          this.#capture(element, "pattern");
          element.pattern = constraint.pattern;
        }
      }
    }
  }
  #read() {
    const first = this.element;
    if (first.tagName === "INPUT") {
      const input = first;
      if (input.type === "radio")
        return this.elements.find((item) => item.checked)?.value ?? "";
      if (input.type === "checkbox") {
        if (Array.isArray(this.#initial))
          return this.elements.filter((item) => item.checked).map((item) => item.value);
        return input.checked;
      }
      if (input.type === "number" && typeof this.#initial === "number")
        return Number.isNaN(input.valueAsNumber) ? 0 : input.valueAsNumber;
    }
    return first.value;
  }
  #write(value) {
    const first = this.element;
    if (first.tagName === "INPUT" && first.type === "radio") {
      for (const item of this.elements)
        item.checked = String(item.value) === String(value);
    } else if (first.tagName === "INPUT" && first.type === "checkbox") {
      for (const item of this.elements)
        item.checked = Array.isArray(value) ? value.map(String).includes(item.value) : Boolean(value);
    } else
      first.value = value === null ? "" : String(value);
  }
  #prepareAccessibility(formId) {
    const error = this.#errorElement;
    if (error === undefined)
      return;
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
  #renderErrors() {
    if (this.#errorElement !== undefined)
      this.#errorElement.textContent = this.#showErrors ? this.errors()[0] ?? "" : "";
  }
  #capture(element, name) {
    let attributes = this.#originalAttributes.get(element);
    if (attributes === undefined) {
      attributes = new Map;
      this.#originalAttributes.set(element, attributes);
    }
    if (!attributes.has(name))
      attributes.set(name, element.getAttribute(name));
  }
  #restoreAttributes(element) {
    for (const [name, value] of this.#originalAttributes.get(element) ?? []) {
      if (value === null)
        element.removeAttribute(name);
      else
        element.setAttribute(name, value);
    }
  }
  #assertActive() {
    if (this.#lifecycle.destroyed)
      throw new FormBuilderError(`field "${this.name}" has been destroyed.`);
  }
}
function subscribe(callbacks, callback) {
  callbacks.add(callback);
  return once(() => {
    callbacks.delete(callback);
  });
}
function equalValue(left, right) {
  return Array.isArray(left) && Array.isArray(right) ? left.length === right.length && left.every((value, index) => Object.is(value, right[index])) : Object.is(left, right);
}
var init_form_control = __esm(() => {
  init_signals();
  init_dom();
  init_errors();
});

// ../packages/frontend/src/forms/request-owner.ts
class SubmissionRequestOwner {
  #current;
  #destroyed = false;
  begin() {
    if (this.#destroyed)
      throw new Error("Form request owner has been destroyed.");
    this.#current?.abort();
    const controller = new AbortController;
    this.#current = controller;
    return controller;
  }
  owns(controller) {
    return !this.#destroyed && this.#current === controller;
  }
  finish(controller) {
    if (!this.owns(controller))
      return false;
    this.#current = undefined;
    return true;
  }
  destroy() {
    if (this.#destroyed)
      return;
    this.#destroyed = true;
    this.#current?.abort();
    this.#current = undefined;
  }
}
function isIntentionalAbort(error) {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

// ../packages/frontend/src/forms/submit.ts
function submissionMode(hasActionAttribute) {
  return hasActionAttribute ? "native" : "fetch";
}
function createFetchSubmission(form, pageUrl) {
  const method = (form.getAttribute("method") ?? "get").trim().toUpperCase() || "GET";
  const data = new FormData(form);
  if (method === "GET" || method === "HEAD") {
    const url = new URL(pageUrl);
    for (const [name, value] of data) {
      if (typeof value === "string")
        url.searchParams.append(name, value);
      else
        url.searchParams.append(name, value.name);
    }
    return Object.freeze({ url: url.href, init: Object.freeze({ method }) });
  }
  return Object.freeze({ url: pageUrl, init: Object.freeze({ method, body: data }) });
}
function normalizeServerErrors(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return Object.freeze({ fields: Object.freeze({}) });
  const record = value;
  const fields = Object.create(null);
  const errors = record["errors"];
  if (typeof errors === "object" && errors !== null && !Array.isArray(errors)) {
    for (const [name, message] of Object.entries(errors)) {
      if (name !== "__proto__" && name !== "prototype" && name !== "constructor" && typeof message === "string")
        fields[name] = message;
    }
  }
  return Object.freeze({
    ...typeof record["message"] === "string" ? { message: record["message"] } : {},
    fields: Object.freeze(fields)
  });
}

// ../packages/frontend/src/forms/form-group.ts
class FormGroup {
  element;
  value;
  status = signal("valid");
  touched = signal(false);
  dirty = signal(false);
  submitted = signal(false);
  submitting = signal(false);
  #controls;
  #validators;
  #fetch;
  #formErrorElement;
  #originalFormErrorText;
  #changeCallbacks = new Set;
  #submitCallbacks = new Set;
  #successCallbacks = new Set;
  #errorCallbacks = new Set;
  #formError;
  #validationFormError;
  #lastChange;
  #destroyed = false;
  #submitListener;
  #invalidListener;
  #lifecycle = new CleanupRegistry;
  #requests = new SubmissionRequestOwner;
  constructor(element, controls, validators, fetchImplementation, onDestroy) {
    this.element = element;
    this.#controls = controls;
    this.#validators = validators;
    this.#fetch = fetchImplementation;
    this.#formErrorElement = findFormErrorElement(element);
    this.#originalFormErrorText = this.#formErrorElement?.textContent ?? undefined;
    this.value = signal(this.#readValue());
    this.#lastChange = stableValue(this.value());
    for (const control of Object.values(this.#controls)) {
      control.setMutationCallback(() => this.#mutated());
    }
    this.#submitListener = (event) => {
      this.#submit(event);
    };
    this.#invalidListener = () => {
      this.submitted.set(true);
      synchronizeBooleanState(this.element, "data-wbr-submitted", true);
      this.markAsTouched();
      this.validate();
    };
    element.addEventListener("submit", this.#submitListener);
    element.addEventListener("invalid", this.#invalidListener, true);
    this.#lifecycle.add(() => element.removeEventListener("submit", this.#submitListener));
    this.#lifecycle.add(() => element.removeEventListener("invalid", this.#invalidListener, true));
    this.#lifecycle.add(() => this.#requests.destroy());
    this.#lifecycle.add(onDestroy);
    for (const control of this.#values())
      this.#lifecycle.add(() => control.destroy());
    this.validate(false);
  }
  valid = () => this.status() === "valid";
  invalid = () => this.status() === "invalid";
  field(name) {
    this.#assertActive();
    const control = this.#controls[name];
    if (control === undefined)
      throw new FormBuilderError(`field "${name}" is not registered.`);
    return control;
  }
  setValue(value) {
    this.#assertActive();
    const expected = Object.keys(this.#controls);
    const received = Object.keys(value);
    if (expected.length !== received.length || expected.some((name) => !Object.hasOwn(value, name))) {
      throw new FormBuilderError("setValue() requires every registered field and no unknown fields.");
    }
    this.patchValue(value);
  }
  patchValue(value) {
    this.#assertActive();
    for (const key of Object.keys(value)) {
      const control = this.#controls[key];
      if (control === undefined)
        throw new FormBuilderError(`patchValue() received unknown field "${key}".`);
      const next = value[key];
      if (next !== undefined)
        control.setValue(next);
    }
    this.#mutated();
  }
  setError(message) {
    this.#assertActive();
    this.#formError = message;
    this.#renderFormError();
    this.#synchronizeStatus("invalid");
  }
  clearError() {
    this.#assertActive();
    this.#formError = undefined;
    this.#renderFormError();
    this.validate();
  }
  markAsTouched() {
    this.#assertActive();
    for (const control of this.#values())
      control.markAsTouched();
    this.#syncInteraction();
  }
  markAsUntouched() {
    this.#assertActive();
    for (const control of this.#values())
      control.markAsUntouched();
    this.#syncInteraction();
  }
  markAsDirty() {
    this.#assertActive();
    for (const control of this.#values())
      control.markAsDirty();
    this.#syncInteraction();
  }
  markAsPristine() {
    this.#assertActive();
    for (const control of this.#values())
      control.markAsPristine();
    this.#syncInteraction();
  }
  validate(showErrors = this.submitted() || this.touched()) {
    this.#assertActive();
    this.#validationFormError = undefined;
    for (const control of this.#values())
      control.setFormErrors(Object.freeze([]));
    let valid = this.#values().every((control) => control.validate(showErrors));
    const issues = new Map;
    for (const validator of this.#validators) {
      const issue = validator.validate(this.#readValue());
      if (issue === null)
        continue;
      valid = false;
      if (issue.field === undefined)
        this.#validationFormError = issue.message;
      else {
        const key = issue.field;
        const messages = issues.get(key) ?? [];
        messages.push(issue.message);
        issues.set(key, messages);
      }
    }
    for (const [key, messages] of issues)
      this.#controls[key]?.setFormErrors(Object.freeze(messages));
    if (this.#formError !== undefined || this.#validationFormError !== undefined)
      valid = false;
    this.#synchronizeStatus(valid ? "valid" : "invalid");
    this.#renderFormError();
    return valid;
  }
  onChange(callback) {
    this.#assertActive();
    return subscribe2(this.#changeCallbacks, callback);
  }
  onSubmit(callback) {
    this.#assertActive();
    return subscribe2(this.#submitCallbacks, callback);
  }
  onSuccess(callback) {
    this.#assertActive();
    return subscribe2(this.#successCallbacks, callback);
  }
  onError(callback) {
    this.#assertActive();
    return subscribe2(this.#errorCallbacks, callback);
  }
  destroy() {
    if (this.#destroyed)
      return;
    this.#destroyed = true;
    this.#lifecycle.destroy();
    this.#changeCallbacks.clear();
    this.#submitCallbacks.clear();
    this.#successCallbacks.clear();
    this.#errorCallbacks.clear();
    this.#validators = Object.freeze([]);
    this.#fetch = undefined;
    for (const key of Object.keys(this.#controls))
      delete this.#controls[key];
    this.#formError = undefined;
    this.#validationFormError = undefined;
    for (const name of ["data-wbr-valid", "data-wbr-invalid", "data-wbr-pending", "data-wbr-touched", "data-wbr-dirty", "data-wbr-submitted", "data-wbr-submitting"])
      this.element.removeAttribute(name);
    if (this.#formErrorElement !== undefined)
      this.#formErrorElement.textContent = this.#originalFormErrorText ?? "";
    this.#formErrorElement = undefined;
  }
  #mutated() {
    if (this.#destroyed)
      return;
    this.clearErrorWithoutValidation();
    const next = this.#readValue();
    this.value.set(next);
    this.validate();
    this.#syncInteraction();
    const serialized = stableValue(next);
    if (serialized !== this.#lastChange) {
      this.#lastChange = serialized;
      for (const callback of this.#changeCallbacks)
        callback(next);
    }
  }
  async#submit(event) {
    if (this.#destroyed) {
      event.preventDefault();
      return;
    }
    this.submitted.set(true);
    synchronizeBooleanState(this.element, "data-wbr-submitted", true);
    if (this.submitting()) {
      event.preventDefault();
      return;
    }
    this.markAsTouched();
    if (!this.validate(true)) {
      event.preventDefault();
      this.element.reportValidity();
      return;
    }
    const current = this.#readValue();
    for (const callback of this.#submitCallbacks)
      callback(current);
    if (submissionMode(this.element.hasAttribute("action")) === "native")
      return;
    event.preventDefault();
    this.submitting.set(true);
    synchronizeBooleanState(this.element, "data-wbr-submitting", true);
    const controller = this.#requests.begin();
    try {
      const request = createFetchSubmission(this.element, globalThis.location.href);
      const fetchImplementation = this.#fetch;
      if (fetchImplementation === undefined)
        return;
      const response = await fetchImplementation(request.url, { ...request.init, signal: controller.signal });
      if (!this.#requests.owns(controller))
        return;
      if (!response.ok) {
        await this.#mapResponseErrors(response);
        if (!this.#requests.owns(controller))
          return;
        const failure = new Error(`Form submission failed with HTTP ${response.status}.`);
        for (const callback of this.#errorCallbacks)
          callback(failure);
        return;
      }
      for (const callback of this.#successCallbacks)
        callback(response);
    } catch (error) {
      if (this.#requests.owns(controller) && !isIntentionalAbort(error)) {
        for (const callback of this.#errorCallbacks)
          callback(error);
      }
    } finally {
      if (this.#requests.finish(controller) && !this.#destroyed) {
        this.submitting.set(false);
        synchronizeBooleanState(this.element, "data-wbr-submitting", false);
      }
    }
  }
  async#mapResponseErrors(response) {
    if (this.#destroyed)
      return;
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/json"))
      return;
    let body;
    try {
      body = await response.clone().json();
    } catch {
      return;
    }
    if (this.#destroyed)
      return;
    const normalized = normalizeServerErrors(body);
    for (const [name, message] of Object.entries(normalized.fields)) {
      const control = this.#controls[name];
      if (control !== undefined)
        control.setError(message);
    }
    if (normalized.message !== undefined)
      this.setError(normalized.message);
    this.markAsTouched();
    this.validate(true);
  }
  #readValue() {
    const output = Object.create(null);
    for (const [name, control] of Object.entries(this.#controls))
      output[name] = control.value();
    return Object.freeze(output);
  }
  #values() {
    return Object.values(this.#controls);
  }
  #syncInteraction() {
    const touched = this.#values().some((control) => control.touched());
    const dirty = this.#values().some((control) => control.dirty());
    this.touched.set(touched);
    this.dirty.set(dirty);
    synchronizeBooleanState(this.element, "data-wbr-touched", touched);
    synchronizeBooleanState(this.element, "data-wbr-dirty", dirty);
  }
  #synchronizeStatus(status) {
    this.status.set(status);
    synchronizeStatus(this.element, status);
  }
  #renderFormError() {
    if (this.#formErrorElement !== undefined) {
      this.#formErrorElement.textContent = this.#formError ?? (this.submitted() || this.touched() ? this.#validationFormError ?? "" : "");
    }
  }
  clearErrorWithoutValidation() {
    this.#formError = undefined;
    this.#renderFormError();
  }
  #assertActive() {
    if (this.#destroyed)
      throw new FormBuilderError(`form "#${this.element.id}" has been destroyed.`);
  }
}
function subscribe2(callbacks, callback) {
  callbacks.add(callback);
  return once(() => {
    callbacks.delete(callback);
  });
}
function stableValue(value) {
  return JSON.stringify(value, (_key, item) => item instanceof File ? Object.freeze({ name: item.name, size: item.size, type: item.type }) : item);
}
var init_form_group = __esm(() => {
  init_signals();
  init_dom();
  init_errors();
});

// ../packages/frontend/src/forms/validators.ts
var field = (kind, message, validate, constraint) => Object.freeze({
  scope: "field",
  kind,
  message,
  validate,
  ...constraint === undefined ? {} : { constraint: Object.freeze(constraint) }
}), finiteInteger = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  return value;
}, finiteNumber = (value, name) => {
  if (!Number.isFinite(value))
    throw new RangeError(`${name} must be finite.`);
  return value;
}, empty = (value) => value === null || value === "" || value === false || Array.isArray(value) && value.length === 0, regexSource = (input) => {
  const source = typeof input === "string" ? input : input.source;
  if (source.length === 0)
    throw new RangeError("Pattern must not be empty.");
  return source;
}, validators;
var init_validators = __esm(() => {
  validators = Object.freeze({
    required: (message = "This field is required.") => field("required", message, (value) => !empty(value), { required: true }),
    string: (message = "Enter a valid value.") => field("string", message, (value) => typeof value === "string"),
    email: (message = "Enter a valid email address.") => field("email", message, (value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value), { type: "email" }),
    number: (message = "Enter a valid number.") => field("number", message, (value) => value === "" || Number.isFinite(typeof value === "number" ? value : Number(value)), { type: "number" }),
    boolean: (message = "Enter a valid boolean value.") => field("boolean", message, (value) => typeof value === "boolean"),
    minLength: (length, message = `Enter at least ${length} characters.`) => {
      const limit = finiteInteger(length, "Minimum length");
      return field("minLength", message, (value) => value === "" || value.length >= limit, { minLength: limit });
    },
    maxLength: (length, message = `Enter no more than ${length} characters.`) => {
      const limit = finiteInteger(length, "Maximum length");
      return field("maxLength", message, (value) => value.length <= limit, { maxLength: limit });
    },
    min: (minimum, message = `Enter a value of at least ${minimum}.`) => {
      const limit = finiteNumber(minimum, "Minimum");
      return field("min", message, (value) => value === "" || Number(value) >= limit, { min: limit });
    },
    max: (maximum, message = `Enter a value no greater than ${maximum}.`) => {
      const limit = finiteNumber(maximum, "Maximum");
      return field("max", message, (value) => value === "" || Number(value) <= limit, { max: limit });
    },
    pattern: (pattern, message = "Enter a value in the required format.") => {
      const source = regexSource(pattern);
      const expression = new RegExp(`^(?:${source})$`, typeof pattern === "string" ? "u" : pattern.flags.replaceAll("g", "").replaceAll("y", ""));
      return field("pattern", message, (value) => value === "" || expression.test(value), { pattern: source });
    },
    match: (first, second, message = "Values do not match.") => Object.freeze({ scope: "form", kind: "match", validate: (value) => Object.is(value[first], value[second]) ? null : Object.freeze({ field: second, message }) }),
    form: (predicate, options) => Object.freeze({ scope: "form", kind: "form", validate: (value) => predicate(value) ? null : Object.freeze({ ...options.field === undefined ? {} : { field: options.field }, message: options.message }) })
  });
});

// ../packages/frontend/src/forms/form.ts
function FormBuilder(formId, definition, options = {}) {
  if (typeof document === "undefined")
    throw new Error("Warbler FormBuilder requires a browser document.");
  const form = findForm(formId, document);
  return owners.replace(form, () => {
    const declared = definition(validators);
    const controls = Object.create(null);
    try {
      for (const [name, item] of Object.entries(declared)) {
        const [initial, ...rules] = item;
        controls[name] = new FormControl(name, form, findNamedControls(form, name), initial, rules);
      }
    } catch (error) {
      for (const control of Object.values(controls))
        control.destroy();
      throw error;
    }
    const configured = typeof options.validators === "function" ? options.validators(validators) : options.validators ?? Object.freeze([]);
    let group;
    try {
      group = new FormGroup(form, controls, configured, options.fetch ?? globalThis.fetch.bind(globalThis), () => owners.release(form, group));
    } catch (error) {
      for (const control of Object.values(controls))
        control.destroy();
      throw error;
    }
    return group;
  });
}
var owners;
var init_form = __esm(() => {
  init_dom();
  init_form_control();
  init_form_group();
  init_validators();
  owners = new InstanceRegistry;
});

// ../packages/frontend/src/forms/index.ts
var init_forms = __esm(() => {
  init_form();
  init_serialize();
});

// resources/js/pages/auth.ts
var exports_auth = {};
var loginForm;
var init_auth = __esm(() => {
  init_forms();
  loginForm = FormBuilder("login-form", (v) => ({
    email: [
      "test@example.com",
      v.required("Email is required"),
      v.email("Enter a valid email")
    ],
    password: [
      "",
      v.required("Password is required"),
      v.string(),
      v.minLength(8, "Password must contain at least 8 characters")
    ],
    confirmPassword: [
      "",
      v.required("Confirm your password")
    ],
    remember: [false, v.boolean()]
  }), {
    validators: (v) => [
      v.match("password", "confirmPassword", "Passwords do not match")
    ]
  });
  loginForm.onSubmit((value) => {
    console.log("submit:", value);
  });
});

// resources/js/app.ts
Promise.resolve().then(() => init_auth());
document.documentElement.dataset.warbler = "ready";

//# debugId=9F469283D2DF9C2E64756E2164756E21
