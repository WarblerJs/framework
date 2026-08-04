#!/usr/bin/env bun
import { runCLI } from "./cli";

const exitCode = await runCLI(process.argv.slice(2));
process.exitCode = exitCode;
