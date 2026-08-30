const LOCAL_CLI_MARKER = "WARBLER_LOCAL_CLI";

export async function delegateToProjectCLI(
  argv: readonly string[],
  currentEntry: string,
  cwd = process.cwd(),
): Promise<number | undefined> {
  if (process.env[LOCAL_CLI_MARKER] === "1") {
    return undefined;
  }

  const resolutionRoot = resolveDelegationRoot(argv, cwd);

  let localEntry: string;

  try {
    localEntry = Bun.resolveSync(
      "@warblerjs/cli/bin",
      resolutionRoot,
    );
  } catch {
    return undefined;
  }

  if (localEntry === currentEntry) {
    return undefined;
  }

  const environment = Object.assign(
    {},
    process.env,
    {
      [LOCAL_CLI_MARKER]: "1",
    },
  );

  const command = new Array<string>(
    argv.length + 2,
  );

  command[0] = process.execPath;
  command[1] = localEntry;

  for (
    let index = 0, length = argv.length;
    index < length;
    index += 1
  ) {
    const argument = argv[index]!;

    if (
      index > 0 &&
      argv[index - 1] === "--project"
    ) {
      command[index + 2] = resolutionRoot;
      continue;
    }

    if (argument.startsWith("--project=")) {
      command[index + 2] =
        `--project=${resolutionRoot}`;

      continue;
    }

    command[index + 2] = argument;
  }

  const child = Bun.spawn(
    command,
    {
      cwd: resolutionRoot,
      env: environment,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  return await child.exited;
}

export function resolveDelegationRoot(
  argv: readonly string[],
  cwd: string,
): string {
  for (
    let index = 0, length = argv.length;
    index < length;
    index += 1
  ) {
    const argument = argv[index];

    if (argument === "--project") {
      const project = argv[index + 1];

      if (project !== undefined && project.length > 0) {
        return absoluteFrom(cwd, project);
      }

      return cwd;
    }

    if (argument?.startsWith("--project=") === true) {
      const project = argument.slice("--project=".length);

      return project.length > 0
        ? absoluteFrom(cwd, project)
        : cwd;
    }
  }

  return cwd;
}

function absoluteFrom(
  cwd: string,
  value: string,
): string {
  if (value.startsWith("/")) {
    return value;
  }

  return cwd.endsWith("/")
    ? `${cwd}${value}`
    : `${cwd}/${value}`;
}