import type { FormStatus } from "./types";

export interface InteractionState { readonly touched: boolean; readonly dirty: boolean }
export type InteractionTransition = "touch" | "untouch" | "dirty" | "pristine";

/** Pure interaction transition used by form and field state semantics. */
export function transitionInteractionState(
  state: InteractionState,
  transition: InteractionTransition,
): InteractionState {
  switch (transition) {
    case "touch": return Object.freeze({ ...state, touched: true });
    case "untouch": return Object.freeze({ ...state, touched: false });
    case "dirty": return Object.freeze({ ...state, dirty: true });
    case "pristine": return Object.freeze({ ...state, dirty: false });
  }
}

/** Synchronizes one mutually-exclusive Warbler validation state on a DOM element. */
export function synchronizeStatus(element: Element, status: FormStatus): void {
  element.removeAttribute("data-wbr-valid");
  element.removeAttribute("data-wbr-invalid");
  element.removeAttribute("data-wbr-pending");
  element.setAttribute(`data-wbr-${status}`, "");
}

export function synchronizeBooleanState(element: Element, name: string, enabled: boolean): void {
  if (enabled) element.setAttribute(name, "");
  else element.removeAttribute(name);
}
