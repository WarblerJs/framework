import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { dependencyFields, WARBLER_SCOPE, ReleaseError, type PackedPackage } from "./types";
import { dependencyRecord } from "./manifest";

export async function smokePackedTarballs(root: string, packedPackages: readonly PackedPackage[]): Promise<void> {
  const consumer = await mkdtemp(join(tmpdir(), "warbler-packed-smoke-"));
  try {
    await mkdir(join(consumer, "node_modules/@warblerjs"), { recursive: true });
    for (let index = 0, length = packedPackages.length; index < length; index += 1) {
      const item = packedPackages[index]!;
      await symlinkExternalDependencies(root, consumer, item);
      const destination = join(consumer, "node_modules", item.packageName);
      await mkdir(destination, { recursive: true });
      await extractTarball(item.tarball, destination);
    }
    for (let index = 0, length = packedPackages.length; index < length; index += 1) {
      await importPackage(consumer, packedPackages[index]!.packageName);
    }
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
}

async function symlinkExternalDependencies(root: string, consumer: string, item: PackedPackage): Promise<void> {
  const seen = new Set<string>();
  for (let fieldIndex = 0, fieldLength = dependencyFields.length; fieldIndex < fieldLength; fieldIndex += 1) {
    const dependencies = dependencyRecord(item.manifest, dependencyFields[fieldIndex]!);
    const names = Object.keys(dependencies);
    for (let index = 0, length = names.length; index < length; index += 1) {
      const name = names[index]!;
      if (name.startsWith(WARBLER_SCOPE) || seen.has(name)) continue;
      seen.add(name);
      await symlinkExternalDependency(root, consumer, name);
    }
  }
}

async function symlinkExternalDependency(root: string, consumer: string, name: string): Promise<void> {
  const source = await resolveInstalledPackageRoot(root, name);
  if (source === undefined) return;
  const target = join(consumer, "node_modules", name);
  try {
    await mkdir(dirname(target), { recursive: true });
    await symlink(source, target);
  } catch {
  }
}

async function resolveInstalledPackageRoot(root: string, name: string): Promise<string | undefined> {
  const direct = join(root, "node_modules", name, "package.json");
  if (await Bun.file(direct).exists()) return join(root, "node_modules", name);
  const escaped = name.replace("/", "+");
  const glob = new Bun.Glob(`node_modules/.bun/${escaped}@*/node_modules/${name}/package.json`);
  for await (const path of glob.scan({ cwd: root })) {
    return join(root, path.slice(0, -"/package.json".length));
  }
  return undefined;
}

async function extractTarball(tarball: string, destination: string): Promise<void> {
  const proc = Bun.spawn(["tar", "-xzf", tarball, "--strip-components=1", "-C", destination], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new ReleaseError(`Unable to extract packed tarball: ${stderr.trim()}`);
}

async function importPackage(consumer: string, packageName: string): Promise<void> {
  const source = `await import(${JSON.stringify(packageName)});`;
  const proc = Bun.spawn(["bun", "-e", source], {
    cwd: consumer,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new ReleaseError(`Packed package import failed for ${packageName}: ${stderr.trim() || stdout.trim()}`);
}
