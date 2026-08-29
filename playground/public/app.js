// ../packages/frontend/src/dom/ready.ts
function ready(callback) {
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", callback, { once: true });
  else
    callback();
}

// resources/js/app.ts
var ALL_REGIONS = "All regions";
var ALL_COUNTRIES = "All countries";
function matchesDistributorFilter(input) {
  const regionMatch = input.region === ALL_REGIONS || input.region === input.recordRegion;
  const countryMatch = input.country === ALL_COUNTRIES || input.country === input.recordCountry;
  return regionMatch && countryMatch;
}
function validateDemoFields(fields) {
  for (let index = 0, length = fields.length;index < length; index += 1) {
    const field = fields[index];
    if (field.required && field.value.trim().length === 0) {
      return { valid: false, missingField: field.name };
    }
    if (field.required && field.type === "email" && !field.value.includes("@")) {
      return { valid: false, missingField: field.name };
    }
  }
  return { valid: true, missingField: "" };
}
function closeDesktopMenus(except) {
  const toggles = document.querySelectorAll("[data-desktop-toggle]");
  for (let index = 0, length = toggles.length;index < length; index += 1) {
    const toggle = toggles[index];
    const group = toggle?.closest("[data-desktop-disclosure]");
    if (group === null || group === except)
      continue;
    const panel = group?.querySelector("[data-desktop-panel]");
    toggle?.setAttribute("aria-expanded", "false");
    if (panel !== null)
      panel.hidden = true;
  }
}
function setMobileMenu(open, returnFocus) {
  const button = document.querySelector("[data-mobile-menu-button]");
  const menu = document.querySelector("[data-mobile-menu]");
  if (button === null || menu === null)
    return;
  button.setAttribute("aria-expanded", String(open));
  menu.hidden = !open;
  document.body.dataset.navOpen = open ? "true" : "false";
  if (!open && returnFocus)
    button.focus();
}
function initNavigation(signal) {
  const mobileButton = document.querySelector("[data-mobile-menu-button]");
  if (mobileButton !== null) {
    mobileButton.addEventListener("click", () => {
      const open = mobileButton.getAttribute("aria-expanded") !== "true";
      setMobileMenu(open, false);
    }, { signal });
  }
  const desktopToggles = document.querySelectorAll("[data-desktop-toggle]");
  for (let index = 0, length = desktopToggles.length;index < length; index += 1) {
    const toggle = desktopToggles[index];
    toggle?.addEventListener("click", () => {
      const group = toggle.closest("[data-desktop-disclosure]");
      if (group === null)
        return;
      const panel = group.querySelector("[data-desktop-panel]");
      if (panel === null)
        return;
      const open = toggle.getAttribute("aria-expanded") !== "true";
      closeDesktopMenus(group);
      toggle.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
    }, { signal });
  }
  const mobileSubmenuButtons = document.querySelectorAll("[data-mobile-submenu-button]");
  for (let index = 0, length = mobileSubmenuButtons.length;index < length; index += 1) {
    const toggle = mobileSubmenuButtons[index];
    toggle?.addEventListener("click", () => {
      const id = toggle.getAttribute("aria-controls");
      if (id === null)
        return;
      const panel = document.getElementById(id);
      if (panel === null)
        return;
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
    }, { signal });
  }
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element))
      return;
    if (target.closest("[data-site-header]") !== null)
      return;
    closeDesktopMenus();
  }, { signal });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape")
      return;
    closeDesktopMenus();
    setMobileMenu(false, true);
  }, { signal });
}
function initDistributorDirectory(signal) {
  const root = document.querySelector("[data-distributor-directory]");
  if (root === null)
    return;
  const regionSelect = root.querySelector("[data-distributor-region]");
  const countrySelect = root.querySelector("[data-distributor-country]");
  const count = root.querySelector("[data-distributor-count]");
  const cards = document.querySelectorAll("[data-distributor-card]");
  if (regionSelect === null || countrySelect === null)
    return;
  const apply = () => {
    let visible = 0;
    for (let index = 0, length = cards.length;index < length; index += 1) {
      const card = cards[index];
      const shown = matchesDistributorFilter({
        region: regionSelect.value,
        country: countrySelect.value,
        recordRegion: card.dataset.region ?? "",
        recordCountry: card.dataset.country ?? ""
      });
      card.hidden = !shown;
      if (shown)
        visible += 1;
    }
    if (count !== null) {
      count.textContent = `Showing ${visible} fictional distributor record${visible === 1 ? "" : "s"}.`;
    }
  };
  regionSelect.addEventListener("change", apply, { signal });
  countrySelect.addEventListener("change", apply, { signal });
  apply();
}
function collectDemoFields(form) {
  const controls = form.querySelectorAll("input, select, textarea");
  const fields = [];
  for (let index = 0, length = controls.length;index < length; index += 1) {
    const control = controls[index];
    fields.push({
      name: control.name || control.id || "field",
      value: control.value,
      required: control.required,
      type: control instanceof HTMLInputElement ? control.type : ""
    });
  }
  return fields;
}
function initDemoForms(signal) {
  const forms = document.querySelectorAll("[data-demo-form]");
  for (let index = 0, length = forms.length;index < length; index += 1) {
    const form = forms[index];
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const status = form.querySelector("[data-form-status]");
      const controls = form.querySelectorAll("input, select, textarea");
      for (let controlIndex = 0, controlLength = controls.length;controlIndex < controlLength; controlIndex += 1) {
        controls[controlIndex]?.setAttribute("aria-invalid", "false");
      }
      const result = validateDemoFields(collectDemoFields(form));
      if (!result.valid) {
        for (let controlIndex = 0, controlLength = controls.length;controlIndex < controlLength; controlIndex += 1) {
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
    const controller = new AbortController;
    initNavigation(controller.signal);
    initDistributorDirectory(controller.signal);
    initDemoForms(controller.signal);
    window.addEventListener("pagehide", () => controller.abort(), { once: true });
  });
}

//# debugId=91D026C9F7B3ED5164756E2164756E21
