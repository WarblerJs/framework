import { CLIError } from "../../errors";
import { ExitCode } from "../../types";

export interface NormalizedGraphName {
  readonly directoryName: string;
  readonly identifierBase: string;
  readonly routePrefix: string;
  readonly routeNamePrefix: string;
}

/** Normalizes an untrusted Graph name for paths, identifiers, and route metadata. */
export function normalizeGraphName(value: string | undefined): NormalizedGraphName {
  if (value === undefined || value.length === 0) throw invalidName();
  if (value.includes("\0") || value.includes("/") || value.includes("\\") || value.includes(".") || value.includes(":")) throw invalidName();
  const words = splitWords(value);
  if (words.length === 0) throw invalidName();
  const directoryName = words.join("-");
  const identifierBase = words.map(capitalizeAscii).join("");
  const routeNamePrefix = words.join(".");
  return Object.freeze({
    directoryName,
    identifierBase,
    routePrefix: `/${directoryName}`,
    routeNamePrefix,
  });
}

function splitWords(value: string): readonly string[] {
  const separated = value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[-_\s]+/gu, " ")
    .trim();
  if (separated.length === 0) return Object.freeze([]);
  const words = separated.split(" ").map((item) => item.toLowerCase());
  return /^[a-z][a-z0-9]*(?: [a-z][a-z0-9]*)*$/u.test(words.join(" "))
    ? Object.freeze(words)
    : Object.freeze([]);
}

function capitalizeAscii(value: string): string {
  return `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function invalidName(): CLIError {
  return new CLIError(
    "CLI5201",
    "Graph name must be letters, numbers, dashes, or underscores; it must start with a letter and cannot contain paths.",
    ExitCode.INVALID_ARGUMENTS,
  );
}
