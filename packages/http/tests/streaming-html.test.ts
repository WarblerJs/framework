import { describe, expect, test } from "bun:test";
import { HtmlStreamRes } from "../src";

describe("HTML streaming", () => {
  test("streams async iterable chunks without collection", async () => {
    async function* source() {
      yield "<p>";
      yield "hello</p>";
    }
    const response = HtmlStreamRes(source());
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe("<p>hello</p>");
  });

  test("propagates pre-read cancellation", async () => {
    const controller = new AbortController();
    let pulls = 0;
    async function* source() {
      pulls++;
      yield "never";
    }
    controller.abort();
    const response = HtmlStreamRes(source(), { signal: controller.signal });
    expect(await response.text()).toBe("");
    expect(pulls).toBe(0);
  });
});
