export const viewConfig = {
  enabled: true,
  engine: "warbler",
  path: "resources/views",
  extension: ".html",
  public: "public",
  cache: false,
  hotReload: true,
  minify: false,
  assets: {
    enabled: true,
    scripts: {
      entries: {
        app: "resources/js/app.ts",
      },
    },
    styles: {
      entries: {
        app: "resources/css/app.css",
      },
    },
    development: {
      watch: true,
      liveReload: true,
      cssHotReload: true,
      console: true,
      sourceMaps: true,
    },
    production: {
      minify: true,
    },
  },
} as const;
