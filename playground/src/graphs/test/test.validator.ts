import { defineValidator, v } from "@warbler/validators";

export const testValidator = defineValidator({
  csrf: true,

  bodyRules: {
    message: v
      .string("validators.invalidMessage")
      .min(1, "validators.invalidMessage"),
  },
});