/** Startup-time static file policy. */
export interface StaticPolicy {
  readonly enabled: boolean;
  readonly root: string;
  readonly prefix: string;
  readonly indexFiles: readonly string[];
  readonly exposeDotfiles: boolean;
  readonly exposeSourceMaps: boolean;
  readonly cacheControl: Readonly<{
    readonly enabled: boolean;
    readonly immutableAssets: boolean;
  }>;
}
