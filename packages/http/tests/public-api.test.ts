import { describe, expect, test } from "bun:test";
import * as api from "../src";

describe("public API", () => {
  test("exports only stable root contracts", () => {
    expect(Object.keys(api).sort()).toEqual([
      "ArchiveRes", "Controller", "Delete", "DownloadRes", "EmptyRes", "FileRes", "Get",
      "Head", "HtmlRes", "HtmlStreamRes", "HttpMethod", "ImageRes", "JsonRes", "Options", "Patch", "PdfRes",
      "Post", "Put", "RESERVED_VIEW_BUILTIN_NAMES", "RedirectRes", "RequestContextFrozenError",
      "Sse", "SseRes", "TextRes",
      "createHttpRuntimeLauncher", "csrf", "defineHttpGraph", "defineHttpRoute", "prepareHttpValidationInput", "redirect", "redirectTo", "view",
    ]);
  });
});
