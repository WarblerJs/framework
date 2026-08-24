#!/usr/bin/env bun
import { discoverPublishablePackages, formatPlan, runRelease } from "./release/index";
import { createReleasePlan } from "./release/planner";
import { RegistryNpmClient } from "./release/npm-client";
import { ReleaseError, NPM_REGISTRY, type ExplicitReleaseRequest } from "./release/types";

interface CLIFlags {
  readonly dryRun: boolean;
  readonly packageName?: string;
  readonly fromPackage?: string;
  readonly explicitReleases: readonly ExplicitReleaseRequest[];
  readonly noTests: boolean;
  readonly json: boolean;
  readonly registry: string;
  readonly allowDirty: boolean;
}

const root = new URL("..", import.meta.url).pathname.replace(/\/$/u, "");

try {
  const flags = parseFlags(Bun.argv.slice(2));
  const npm = new RegistryNpmClient(flags.registry);
  const packages = await discoverPublishablePackages(root);
  const plan = await createReleasePlan(root, packages, npm, {
    ...(flags.packageName === undefined ? {} : { packageName: flags.packageName }),
    ...(flags.fromPackage === undefined ? {} : { fromPackage: flags.fromPackage }),
    explicitReleases: flags.explicitReleases,
  });
  if (flags.json) console.log(JSON.stringify({ plan }, null, 2));
  else console.log(formatPlan(plan));

  const result = await runRelease({
    root,
    dryRun: flags.dryRun,
    noTests: flags.noTests,
    json: flags.json,
    registry: flags.registry,
    allowDirty: flags.allowDirty,
    ...(flags.packageName === undefined ? {} : { packageName: flags.packageName }),
    ...(flags.fromPackage === undefined ? {} : { fromPackage: flags.fromPackage }),
    explicitReleases: flags.explicitReleases,
    npm,
  });

  if (flags.json) console.log(JSON.stringify({ result }, null, 2));
  else {
    console.log("");
    console.log(flags.dryRun ? "Dry run complete" : "Release complete");
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
  let packageName: string | undefined;
  let fromPackage: string | undefined;
  let noTests = false;
  let json = false;
  let registry: string = NPM_REGISTRY;
  let allowDirty = false;
  const explicitReleases: ExplicitReleaseRequest[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--dry-run") { dryRun = true; continue; }
    if (arg === "--no-tests") { noTests = true; continue; }
    if (arg === "--json") { json = true; continue; }
    if (arg === "--allow-dirty") { allowDirty = true; continue; }
    if (arg === "--package") { packageName = value(args, ++index, arg); continue; }
    if (arg === "--from") { fromPackage = value(args, ++index, arg); continue; }
    if (arg === "--patch") {
      explicitReleases.push(Object.freeze({ packageName: value(args, ++index, arg), bump: "patch" }));
      continue;
    }
    if (arg === "--registry") { registry = value(args, ++index, arg); continue; }
    throw new ReleaseError(`Unknown release flag: ${arg}`);
  }
  return Object.freeze({
    dryRun,
    noTests,
    json,
    registry,
    allowDirty,
    explicitReleases: Object.freeze(explicitReleases),
    ...(packageName === undefined ? {} : { packageName }),
    ...(fromPackage === undefined ? {} : { fromPackage }),
  });
}

function value(args: readonly string[], index: number, flag: string): string {
  const item = args[index];
  if (item === undefined || item.startsWith("--")) throw new ReleaseError(`${flag} requires a value.`);
  return item;
}
