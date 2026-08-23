import { defineValidator, v } from "@warbler/validators";

export const validateRequest = defineValidator({
    csrf: false,
    queryRules: {
        id: v.number("validators.invalidId"),
    }
})
