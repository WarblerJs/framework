import { v, type InferValidatorOutput } from "@warbler/validators";

export const loginValidator = {
  rules: {
    username: v.string("validators.username_not_valid").trim().min(1, "validators.username_not_valid"),
    password: v.string("invalid_string").min(1, "invalid_string"),
  },
} as const;

export type LoginInput = InferValidatorOutput<typeof loginValidator>;
