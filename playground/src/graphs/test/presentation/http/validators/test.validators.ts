import { defineValidator, v } from "@warbler/framework";

export const validateRequest = defineValidator({
    csrf: false,
    queryRules: {
        id: v.number("validators.invalidId"),
    }
})
