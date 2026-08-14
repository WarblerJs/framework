import { defineValidator, v } from "@warbler/validators";

export const registerValidator = defineValidator({
    bodyRules: {
        email: v.email('validatos.notValidEmail'),
        password: v.string('validatos.notValidPassword').min(6,'validatos.notValidPassword'),
        confirmPassword: v.string('validatos.notValidPassword').min(6,'validatos.notValidPassword'),
    }
})