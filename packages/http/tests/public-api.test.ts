import { describe, expect, test } from "bun:test";
import * as api from "../src";

describe("public API", () => {
  test("exports only stable root contracts", () => {
    expect(Object.keys(api).sort()).toEqual([
      "ArchiveRes", "Controller", "Delete", "DownloadRes", "EmptyRes", "FileRes", "Get",
      "Head", "HtmlRes", "HtmlStreamRes", "ImageRes", "JsonRes", "Options", "Patch", "PdfRes",
      "Post", "Put", "RedirectRes", "Sse", "SseRes", "TextRes",
    ]);
  });
});
