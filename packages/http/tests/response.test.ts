import { describe, expect, test } from "bun:test";
import {
  ArchiveRes,
  DownloadRes,
  EmptyRes,
  HtmlRes,
  ImageRes,
  JsonRes,
  PdfRes,
  RedirectRes,
  TextRes,
} from "../src";

describe("response helpers", () => {
  test("creates native typed responses without overwriting headers", async () => {
    expect(await JsonRes({ ok: true }).json()).toEqual({ ok: true });
    expect(HtmlRes("<p>x</p>").headers.get("content-type")).toContain("text/html");
    expect(TextRes("x", { headers: { "content-type": "custom/type" } }).headers.get("content-type")).toBe("custom/type");
    expect(EmptyRes().status).toBe(204);
  });

  test("guards redirect header injection", () => {
    expect(RedirectRes("/safe").headers.get("location")).toBe("/safe");
    expect(() => RedirectRes("/bad\r\nx: y")).toThrow();
  });

  test("creates lazy file, PDF, image, and archive responses", () => {
    const pdf = new Blob(["pdf"], { type: "application/pdf" });
    const image = new Blob(["png"], { type: "image/png" });
    expect(PdfRes(pdf, { filename: "report.pdf" }).headers.get("content-type")).toBe("application/pdf");
    expect(ImageRes(image, { filename: "image.png" }).headers.get("content-type")).toBe("image/png");
    expect(ArchiveRes(new Blob(["zip"]), { filename: "../bad.zip" }).headers.get("content-disposition")).not.toContain("../");
    expect(DownloadRes(pdf, { filename: "x.zip" }).headers.get("content-disposition")).toContain("attachment");
  });
});
