/// <reference lib="dom" />
import { ready } from "@warblerjs/frontend";

export interface DistributorFilterInput {
  readonly region: string;
  readonly country: string;
  readonly recordRegion: string;
  readonly recordCountry: string;
}

export interface DemoFieldInput {
  readonly name: string;
  readonly value: string;
  readonly required: boolean;
  readonly type: string;
}

export interface DemoValidationResult {
  readonly valid: boolean;
  readonly missingField: string;
}

const ALL_REGIONS = "All regions";
const ALL_COUNTRIES = "All countries";

export function matchesDistributorFilter(input: DistributorFilterInput): boolean {
  const regionMatch = input.region === ALL_REGIONS || input.region === input.recordRegion;
  const countryMatch = input.country === ALL_COUNTRIES || input.country === input.recordCountry;
  return regionMatch && countryMatch;
}

export function validateDemoFields(fields: readonly DemoFieldInput[]): DemoValidationResult {
  for (let index = 0, length = fields.length; index < length; index += 1) {
    const field:any = fields[index];
    if (field.required && field.value.trim().length === 0) {
      return { valid: false, missingField: field.name };
    }
    if (field.required && field.type === "email" && !field.value.includes("@")) {
      return { valid: false, missingField: field.name };
    }
  }
  return { valid: true, missingField: "" };
}

function closeDesktopMenus(except?: HTMLElement): void {
  const toggles = document.querySelectorAll<HTMLButtonElement>("[data-desktop-toggle]");
  for (let index = 0, length = toggles.length; index < length; index += 1) {
    const toggle = toggles[index];
    const group = toggle?.closest<HTMLElement>("[data-desktop-disclosure]");
    if (group === null || group === except) continue;
    const panel = group?.querySelector<HTMLElement>("[data-desktop-panel]") as any;
    toggle?.setAttribute("aria-expanded", "false");
    if (panel !== null) panel.hidden = true;
  }
}

function setMobileMenu(open: boolean, returnFocus: boolean): void {
  const button = document.querySelector<HTMLButtonElement>("[data-mobile-menu-button]");
  const menu = document.querySelector<HTMLElement>("[data-mobile-menu]");
  if (button === null || menu === null) return;
  button.setAttribute("aria-expanded", String(open));
  menu.hidden = !open;
  document.body.dataset.navOpen = open ? "true" : "false";
  if (!open && returnFocus) button.focus();
}

function initNavigation(signal: AbortSignal): void {
  const mobileButton = document.querySelector<HTMLButtonElement>("[data-mobile-menu-button]");
  if (mobileButton !== null) {
    mobileButton.addEventListener("click", () => {
      const open = mobileButton.getAttribute("aria-expanded") !== "true";
      setMobileMenu(open, false);
    }, { signal });
  }

  const desktopToggles = document.querySelectorAll<HTMLButtonElement>("[data-desktop-toggle]");
  for (let index = 0, length = desktopToggles.length; index < length; index += 1) {
    const toggle = desktopToggles[index];
    toggle?.addEventListener("click", () => {
      const group = toggle.closest<HTMLElement>("[data-desktop-disclosure]");
      if (group === null) return;
      const panel = group.querySelector<HTMLElement>("[data-desktop-panel]");
      if (panel === null) return;
      const open = toggle.getAttribute("aria-expanded") !== "true";
      closeDesktopMenus(group);
      toggle.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
    }, { signal });
  }

  const mobileSubmenuButtons = document.querySelectorAll<HTMLButtonElement>("[data-mobile-submenu-button]");
  for (let index = 0, length = mobileSubmenuButtons.length; index < length; index += 1) {
    const toggle = mobileSubmenuButtons[index];
    toggle?.addEventListener("click", () => {
      const id = toggle.getAttribute("aria-controls");
      if (id === null) return;
      const panel = document.getElementById(id);
      if (panel === null) return;
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
    }, { signal });
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-site-header]") !== null) return;
    closeDesktopMenus();
  }, { signal });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeDesktopMenus();
    setMobileMenu(false, true);
  }, { signal });
}

function initDistributorDirectory(signal: AbortSignal): void {
  const root = document.querySelector<HTMLElement>("[data-distributor-directory]");
  if (root === null) return;
  const regionSelect = root.querySelector<HTMLSelectElement>("[data-distributor-region]");
  const countrySelect = root.querySelector<HTMLSelectElement>("[data-distributor-country]");
  const count = root.querySelector<HTMLElement>("[data-distributor-count]");
  const cards = document.querySelectorAll<HTMLElement>("[data-distributor-card]");
  if (regionSelect === null || countrySelect === null) return;

  const apply = (): void => {
    let visible = 0;
    for (let index = 0, length = cards.length; index < length; index += 1) {
      const card:any = cards[index];
      const shown = matchesDistributorFilter({
        region: regionSelect.value,
        country: countrySelect.value,
        recordRegion: card.dataset.region ?? "",
        recordCountry: card.dataset.country ?? "",
      });
      card.hidden = !shown;
      if (shown) visible += 1;
    }
    if (count !== null) {
      count.textContent = `Showing ${visible} fictional distributor record${visible === 1 ? "" : "s"}.`;
    }
  };

  regionSelect.addEventListener("change", apply, { signal });
  countrySelect.addEventListener("change", apply, { signal });
  apply();
}

function collectDemoFields(form: HTMLFormElement): readonly DemoFieldInput[] {
  const controls = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea");
  const fields: DemoFieldInput[] = [];
  for (let index = 0, length = controls.length; index < length; index += 1) {
    const control:any = controls[index];
    fields.push({
      name: control.name || control.id || "field",
      value: control.value,
      required: control.required,
      type: control instanceof HTMLInputElement ? control.type : "",
    });
  }
  return fields;
}

function initDemoForms(signal: AbortSignal): void {
  const forms = document.querySelectorAll<HTMLFormElement>("[data-demo-form]");
  for (let index = 0, length = forms.length; index < length; index += 1) {
    const form = forms[index];
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const status = form.querySelector<HTMLElement>("[data-form-status]");
      const controls = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea");
      for (let controlIndex = 0, controlLength = controls.length; controlIndex < controlLength; controlIndex += 1) {
        controls[controlIndex]?.setAttribute("aria-invalid", "false");
      }
      const result = validateDemoFields(collectDemoFields(form));
      if (!result.valid) {
        for (let controlIndex = 0, controlLength = controls.length; controlIndex < controlLength; controlIndex += 1) {
          const control = controls[controlIndex];
          if (control?.name === result.missingField || control?.id === result.missingField) {
            control.setAttribute("aria-invalid", "true");
            control.focus();
            break;
          }
        }
        if (status !== null) {
          status.dataset.state = "error";
          status.textContent = "Complete the required fields to show the demo state.";
        }
        return;
      }
      if (status !== null) {
        status.dataset.state = "success";
        status.textContent = form.dataset.successMessage ?? "Demo state shown locally. Nothing was sent.";
      }
    }, { signal });
  }
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  ready(() => {
    document.documentElement.dataset.warbler = "ready";
    const controller = new AbortController();
    initNavigation(controller.signal);
    initDistributorDirectory(controller.signal);
    initDemoForms(controller.signal);
    window.addEventListener("pagehide", () => controller.abort(), { once: true });
  });
}
