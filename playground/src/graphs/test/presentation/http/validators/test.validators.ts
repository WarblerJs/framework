import { defineValidator, v } from "@warbler/validators";

export const validateRequest = defineValidator({
    csrf: false,
    queryRules: {
        id: v.number('notValidId').gt(4,'shouldGreate'),
        type: v.string('notValidType').length(4,'shouldGreate')
    }
})