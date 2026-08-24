import { describe, expect, test } from "bun:test";
import { compileViewProject } from "../src";

const project = async (css: string, template = '<div class="flex p-5 sm:block"></div>'): Promise<string> => {
  const root = `/tmp/warbler-tailwind-${crypto.randomUUID()}`;
  await Bun.write(`${root}/resources/css/app.css`, css);
  await Bun.write(`${root}/resources/css/fonts.css`, ".warbler-font { font-family: sans-serif; }");
  await Bun.write(`${root}/resources/views/index.html`, template);
  await Bun.write(`${root}/public/.keep`, "");
  return root;
};

const config = Object.freeze({
  path: "resources/views",
  public: "public",
  assets: {
    enabled: true,
    styles: {
      entries: { app: "resources/css/app.css" },
      tailwind: true,
    },
    production: { minify: true },
  },
} as const);

describe("official Tailwind CSS v4 integration", () => {
  test("compiles CSS-first directives with the official CLI", async () => {
    const root = await project(`
@import "tailwindcss";
@import "./fonts.css";
@plugin "@tailwindcss/forms";
@custom-variant dark (&:is(.dark *));
@theme { --breakpoint-sm: 480px; }
`);
    await compileViewProject({ projectRoot: root, config, mode: "development" });
    const css = await Bun.file(`${root}/public/app.css`).text();
    expect(css).toContain(".flex");
    expect(css).toContain(".p-5");
    expect(css).toContain("480px");
    expect(css).toContain(".warbler-font");
    expect(css).toContain("[type='text']");
  });

  test("minifies production output deterministically", async () => {
    const root = await project('@import "tailwindcss";');
    await compileViewProject({ projectRoot: root, config, mode: "production" });
    const first = await Bun.file(`${root}/public/app.css`).text();
    await compileViewProject({ projectRoot: root, config, mode: "production" });
    const second = await Bun.file(`${root}/public/app.css`).text();
    expect(first).toBe(second);
    expect(first).not.toContain("\n  ");
  });

  test("keeps the previous public artifact when compilation fails", async () => {
    const root = await project('@plugin "@warblerjs/not-installed";');
    await Bun.write(`${root}/public/app.css`, "previous-valid-css");
    await expect(compileViewProject({
      projectRoot: root,
      config,
      mode: "development",
    })).rejects.toMatchObject({ code: "VIEW1002" });
    expect(await Bun.file(`${root}/public/app.css`).text()).toBe("previous-valid-css");
  });

  test("reports invalid entries before spawning a compiler", async () => {
    const root = await project('@import "tailwindcss";');
    await expect(compileViewProject({
      projectRoot: root,
      config: {
        ...config,
        assets: {
          ...config.assets,
          styles: {
            entries: { app: true },
            tailwind: true,
          },
        },
      } as unknown as typeof config,
      mode: "development",
    })).rejects.toThrow("css entry values must be file paths");
  });
});
