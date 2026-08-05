import { expect, test } from "bun:test";
import { classCandidateSignature } from "../src/dev/view-pipeline";

test("View HTML changes rebuild Tailwind only when static class candidates change", () => {
  const before = classCandidateSignature('<h1 class="font-bold">Before</h1>');
  const contentOnly = classCandidateSignature('<h1 class="font-bold">After</h1>');
  const newUtility = classCandidateSignature(
    '<h1 class="font-bold text-indigo-200">After</h1>',
  );

  expect(contentOnly).toBe(before);
  expect(newUtility).not.toBe(before);
  expect(newUtility).toBe("font-bold\u0000text-indigo-200");
});
