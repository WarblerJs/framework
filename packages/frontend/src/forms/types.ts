import type { Signal } from "../signals";

export type FormScalar = string | number | boolean | File | null;
export type FormValue = FormScalar | readonly FormScalar[];
export type FormStatus = "valid" | "invalid" | "pending";
export type FormControlElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export interface NativeConstraint {
  readonly required?: true;
  readonly type?: "email" | "number";
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly min?: number;
  readonly max?: number;
  readonly pattern?: string;
}

export interface FieldValidator<T = FormValue> {
  readonly scope: "field";
  readonly kind: string;
  readonly message: string;
  readonly constraint?: NativeConstraint;
  validate(value: T): boolean;
}

export interface FormValidationIssue<K extends PropertyKey = string> {
  readonly field?: K;
  readonly message: string;
}

export interface FormValidator<T extends Readonly<Record<string, FormValue>>> {
  readonly scope: "form";
  readonly kind: string;
  validate(value: T): FormValidationIssue<keyof T> | null;
}

export type FieldDefinition<T extends FormValue = FormValue> =
  readonly [T, ...readonly FieldValidator<T>[]];
export type FieldDefinitions = Readonly<Record<string, FieldDefinition>>;
export type WidenFormValue<T> =
  T extends string ? string :
  T extends number ? number :
  T extends boolean ? boolean :
  T extends readonly (infer V)[] ? readonly WidenFormValue<V>[] :
  T;
export type InferFieldValue<T> = T extends readonly [infer V, ...readonly unknown[]] ? WidenFormValue<V> : never;
export type InferFormValue<T extends FieldDefinitions> = {
  readonly [K in keyof T]: InferFieldValue<T[K]>;
};

export interface FieldApi<T extends FormValue> {
  readonly element: FormControlElement;
  readonly elements: readonly FormControlElement[];
  readonly value: Signal<T>;
  readonly status: Signal<FormStatus>;
  readonly valid: () => boolean;
  readonly invalid: () => boolean;
  readonly touched: Signal<boolean>;
  readonly dirty: Signal<boolean>;
  readonly errors: Signal<readonly string[]>;
  setValue(value: T): void;
  setError(message: string): void;
  clearError(): void;
  markAsTouched(): void;
  markAsUntouched(): void;
  markAsDirty(): void;
  markAsPristine(): void;
  onInput(callback: (value: T) => void): () => void;
  onChange(callback: (value: T) => void): () => void;
  onFocus(callback: () => void): () => void;
  onBlur(callback: () => void): () => void;
}

export interface FormApi<T extends Readonly<Record<string, FormValue>>> {
  readonly element: HTMLFormElement;
  readonly value: Signal<T>;
  readonly status: Signal<FormStatus>;
  readonly valid: () => boolean;
  readonly invalid: () => boolean;
  readonly touched: Signal<boolean>;
  readonly dirty: Signal<boolean>;
  readonly submitted: Signal<boolean>;
  readonly submitting: Signal<boolean>;
  field<K extends keyof T & string>(name: K): FieldApi<T[K]>;
  setValue(value: T): void;
  patchValue(value: Partial<T>): void;
  setError(message: string): void;
  clearError(): void;
  markAsTouched(): void;
  markAsUntouched(): void;
  markAsDirty(): void;
  markAsPristine(): void;
  validate(): boolean;
  onChange(callback: (value: T) => void): () => void;
  onSubmit(callback: (value: T) => void): () => void;
  onSuccess(callback: (response: Response) => void): () => void;
  onError(callback: (error: unknown) => void): () => void;
  destroy(): void;
}

export interface ValidatorApi {
  required<T extends FormValue>(message?: string): FieldValidator<T>;
  string(message?: string): FieldValidator<string>;
  email(message?: string): FieldValidator<string>;
  number(message?: string): FieldValidator<number | string>;
  boolean(message?: string): FieldValidator<boolean>;
  minLength(length: number, message?: string): FieldValidator<string>;
  maxLength(length: number, message?: string): FieldValidator<string>;
  min(minimum: number, message?: string): FieldValidator<number | string>;
  max(maximum: number, message?: string): FieldValidator<number | string>;
  pattern(pattern: RegExp | string, message?: string): FieldValidator<string>;
  match<T extends Readonly<Record<string, FormValue>>, K extends keyof T & string>(
    first: K, second: K, message?: string,
  ): FormValidator<T>;
  form<T extends Readonly<Record<string, FormValue>>, K extends keyof T & string>(
    predicate: (value: T) => boolean,
    options: Readonly<{ field?: K; message: string }>,
  ): FormValidator<T>;
}

export interface FormBuilderOptions<T extends Readonly<Record<string, FormValue>>> {
  readonly validators?: readonly FormValidator<T>[] | ((validators: ValidatorApi) => readonly FormValidator<T>[]);
  readonly fetch?: typeof globalThis.fetch;
}
