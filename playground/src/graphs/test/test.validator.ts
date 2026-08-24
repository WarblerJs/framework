import { defineValidator, v } from "@warblerjs/framework";

export const testValidator = defineValidator({
  csrf: false,

  bodyRules: {
    message: v
      .string("validators.invalidMessage")
      .min(1, "validators.invalidMessageLength")
      .mapK('message_content')
      .mapV( o => o + ' >>---added'),
    yt: v
      .string('yt_dd')
      .requiredWith('adv'),
    adv: v 
      .string('adv_st')
      .optional()
  },
  paramsRules: {
    id: v
      .number('pr_number_req')
      .mapV( o => o + 50)
  },
  queryRules: {
    id: v
      .number('qy_number_req')
      .mapV( o => o + 50)
  },
  headerRules: {
    'x-language': v
     .string('x_language') 
    // .in(['de','en','fr','ar'],'x_lan_not_allowed')
     .notIn(['ar']),
    'x-pow': v
     .string('x-pow')
     .requiredWith(['x-al'])
  }
});