#!/usr/bin/env bun
import { resolve } from "node:path";
import { syncLockstepVersions } from "./release/sync";
import { ReleaseError } from "./release/types";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/u, "");

try {
  const options = parseArgs(Bun.argv.slice(2));
  const result = await syncLockstepVersions({
    root,
    ...(options.version === undefined ? {} : { version: options.version }),
    ...(options.check ? { check: true } : {}),
  });
  console.log(options.check ? `Lockstep versions are current: ${result.version}` : `Synchronized lockstep versions: ${result.version}`);
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : "Unknown lockstep version failure");
  process.exit(cause instanceof ReleaseError ? 1 : 1);
}

function parseArgs(args: readonly string[]): Readonly<{ readonly version?: string; readonly check: boolean }> {
  let version: string | undefined;
  let check = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "--version") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) throw new ReleaseError("--version requires a value.");
      version = value;
      index++;
      continue;
    }
    if (arg.startsWith("--version=")) {
      version = arg.slice("--version=".length);
      if (version.length === 0) throw new ReleaseError("--version requires a value.");
      continue;
    }
    if (arg === "--root") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) throw new ReleaseError("--root requires a value.");
      resolve(value);
      index++;
      continue;
    }
    throw new ReleaseError(`Unknown sync-version flag: ${arg}`);
  }
  return Object.freeze({
    ...(version === undefined ? {} : { version }),
    check,
  });
}
