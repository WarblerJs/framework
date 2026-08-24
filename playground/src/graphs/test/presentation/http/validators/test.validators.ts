import { defineValidator, v } from "@warblerjs/framework";

export const validateRequest = defineValidator({
    csrf: false,
    queryRules: {
        id: v.number("validators.invalidId"),
    }
})
