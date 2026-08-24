/** Declarative layer preset consumed by the Graph generator. */
export interface ArchitecturePreset {
  readonly description: string;
  readonly layers: readonly string[];
}

export const DEFAULT_ARCHITECTURE = "minimal" as const;

export const architecturePresets = Object.freeze({
  minimal: Object.freeze({
    description: "Smallest useful graph: a declarative graph plus transport-aware presentation.",
    layers: Object.freeze([]),
  }),
  hexagonal: Object.freeze({
    description: "Presentation drives application use cases; domain owns ports; infrastructure implements adapters.",
    layers: Object.freeze([
      "application/use-cases",
      "application/dto",
      "domain/entities",
      "domain/value-objects",
      "domain/errors",
      "domain/ports",
      "infrastructure/persistence",
      "infrastructure/adapters",
    ]),
  }),
  clean: Object.freeze({
    description: "Outer presentation/infrastructure depend inward on application and domain policy.",
    layers: Object.freeze([
      "application/use-cases",
      "application/dto",
      "application/ports",
      "domain/entities",
      "domain/value-objects",
      "domain/errors",
      "infrastructure/persistence",
      "infrastructure/gateways",
    ]),
  }),
  mvc: Object.freeze({
    description: "Warbler-flavored MVC: handlers are controllers, models stay transport-free, views are optional.",
    layers: Object.freeze([
      "models",
      "views",
    ]),
  }),
} as const);
