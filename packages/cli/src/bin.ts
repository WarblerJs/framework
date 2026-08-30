#!/usr/bin/env bun

import {
  delegateToProjectCLI,
} from "./local-cli-launcher";

const argv = process.argv.slice(2);

const delegatedExitCode = await delegateToProjectCLI(
  argv,
  import.meta.path,
);

if (delegatedExitCode !== undefined) {
  process.exitCode = delegatedExitCode;
} else {
  const { runCLI } = await import("./cli");

  process.exitCode = await runCLI(argv);
}