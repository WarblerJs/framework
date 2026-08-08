import { defineValidator, v } from "@warbler/validators";

export const valiateUserID = defineValidator({
  paramRules: {
    id: v.uuid('id_invalid_uuid')
  },
  headerRules: {
    "x-retries": v.coerce.number("validators.invalid_retries").int("validators.invalid_retries").nonnegative("validators.invalid_retries"),
  },

});
