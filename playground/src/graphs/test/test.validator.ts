import { defineValidator, v } from "@warbler/validators";

export const testValidator = defineValidator({
  csrf: false,

  bodyRules: {
    message: v
      .string("validators.invalidMessage")
      .min(1, "validators.invalidMessageLength")
      .mapK('message_content')
      .mapV( o => o + ' >>---added')
      ,
  },
  paramsRules: {
    id: v
      .number('pr_number_req')
  },
  queryRules: {
    id: v
      .number('qy_number_req')
  },
  headerRules: {
    'x-language': v
     .string('x_language') 
     .in(['de','en','fr','ar'],'x_lan_not_allowed')
     .notIn(['ar'])
  }
});