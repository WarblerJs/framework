import { defineValidator, v } from "@warbler/validators";

export const valiateUserID = defineValidator({
  paramRules: {
    id: v.uuid('id_invalid_uuid')
  },
});
