#!/usr/bin/env bun
import { formatPlan, runRelease } from "./release/index";
import { RegistryNpmClient } from "./release/npm-client";
import { ReleaseError, NPM_REGISTRY } from "./release/types";
import { assertSemver } from "./release/semver";

interface CLIFlags {
  readonly dryRun: boolean;
  readonly version: string;
  readonly noTests: boolean;
  readonly json: boolean;
  readonly registry: string;
  readonly allowDirty: boolean;
}

const root = new URL("..", import.meta.url).pathname.replace(/\/$/u, "");

try {
  const flags = parseFlags(Bun.argv.slice(2));
  const npm = new RegistryNpmClient(flags.registry);
  assertSemver(flags.version);

  const result = await runRelease({
    root,
    dryRun: flags.dryRun,
    noTests: flags.noTests,
    json: flags.json,
    registry: flags.registry,
    allowDirty: flags.allowDirty,
    targetVersion: flags.version,
    npm,
    progress: flags.json ? undefined : (phase) => { console.log(phase); },
    onPlan: (plan) => {
      if (flags.json) console.log(JSON.stringify({ plan }, null, 2));
      else console.log(formatPlan(plan));
    },
  });

  if (flags.json) console.log(JSON.stringify({ result }, null, 2));
  else {
    console.log("");
    console.log(flags.dryRun ? "Dry run complete" : "Release complete");
    console.log(`Planned: ${result.planned.length === 0 ? "none" : result.planned.join(", ")}`);
    console.log(`Published: ${result.published.length === 0 ? "none" : result.published.join(", ")}`);
    console.log(`Skipped: ${result.skipped.length === 0 ? "none" : result.skipped.join(", ")}`);
    if (!flags.dryRun) {
      console.log("");
      console.log("Suggested follow-up:");
      console.log('git status --short');
      console.log('git add packages scripts package.json bun.lock docs');
      console.log('git commit -m "chore: publish Warbler packages"');
    }
  }
} catch (cause) {
  const message = cause instanceof Error ? cause.message : "Unknown release failure";
  if (cause instanceof ReleaseError) console.error(`Release failed: ${message}`);
  else console.error(message);
  process.exit(1);
}

function parseFlags(args: readonly string[]): CLIFlags {
  let dryRun = false;
  let version: string | undefined;
  let noTests = false;
  let json = false;
  let registry: string = NPM_REGISTRY;
  let allowDirty = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--dry-run") { dryRun = true; continue; }
    if (arg === "--no-tests") { noTests = true; continue; }
    if (arg === "--json") { json = true; continue; }
    if (arg === "--allow-dirty") { allowDirty = true; continue; }
    if (arg === "--version") { version = value(args, ++index, arg); continue; }
    if (arg === "--registry") { registry = value(args, ++index, arg); continue; }
    throw new ReleaseError(`Unknown release flag: ${arg}`);
  }
  if (version === undefined) throw new ReleaseError("Release requires --version.");
  assertSemver(version);
  return Object.freeze({
    dryRun,
    version,
    noTests,
    json,
    registry,
    allowDirty,
  });
}

function value(args: readonly string[], index: number, flag: string): string {
  const item = args[index];
  if (item === undefined || item.startsWith("--")) throw new ReleaseError(`${flag} requires a value.`);
  return item;
}
