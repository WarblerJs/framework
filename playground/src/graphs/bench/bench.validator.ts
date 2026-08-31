import { defineValidator, v } from "@warblerjs/framework";

export const benchVal = defineValidator({
  csrf: false,
  paramsRules: {
    id: v.string('dldl')
  }
})

export const queryValidator = defineValidator({
  csrf: false,
  queryRules: {
    id: v.number("invalid_id"),
  },
});
