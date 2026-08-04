import ts from "typescript";
import type { CompilerConfig } from "../config/compiler-config";

/** Finds and normalizes the compiler project without reading application modules. */
export function discoverProject(projectRoot: string): CompilerConfig {
  const root = ts.sys.resolvePath(projectRoot);
  const tsconfigPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  return Object.freeze({ projectRoot: root, tsconfigPath: tsconfigPath ?? `${root}/tsconfig.json` });
}

/** Loads the tsconfig and returns one canonical source-file list. */
export function loadProjectConfig(config: CompilerConfig): ts.ParsedCommandLine {
  const read = ts.readConfigFile(config.tsconfigPath, ts.sys.readFile);
  if (read.error !== undefined) return emptyConfig([read.error]);
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    {
      ...ts.sys,
      readDirectory(rootDir, extensions, excludes, includes, depth) {
        const ignored = [...(excludes ?? []), "**/node_modules/**", "**/dist/**", "**/generated/**"];
        return ts.sys.readDirectory(rootDir, extensions, ignored, includes, depth);
      },
    },
    config.projectRoot,
    undefined,
    config.tsconfigPath,
  );
  return parsed;
}

function emptyConfig(errors: readonly ts.Diagnostic[]): ts.ParsedCommandLine {
  return { options: { strict: true, noEmit: true }, fileNames: [], errors: [...errors], wildcardDirectories: {}, compileOnSave: false, raw: {}, typeAcquisition: { enable: false, include: [], exclude: [] } };
}
