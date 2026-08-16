import { defineValidator, v } from "@warbler/validators";

export const loginValidators = defineValidator({
    bodyRules: {
        email: v.email('not_valid_email'),
        password: v.string('string').min(6),
        remember: v.string('string')
    }
})