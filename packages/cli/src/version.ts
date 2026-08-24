import packageMetadata from "../package.json" with { type: "json" };

/** Version of the installed Warbler CLI package. */
export const CLI_VERSION = packageMetadata.version;