import { defineValidator, v } from "@warbler/validators";

export const testValidator = defineValidator({
  csrf: false,

  bodyRules: {
    message: v
      .number("validators.invalidMessage")
      .lessThan(10, "validators.invalidMessageLen")
      .mapK('message_content')
      .mapV( o => o + ' -->This added')
  },
  headerRules: {
    'x-language': v
      .string('validators.languageHeader')
      .in(['en','de','fr'],'validators.languageHeaderNotAllowed')
      .notIn(['de'],'validators.languageHeaderNotAllowed2')
  },
  paramsRules: {
    id: v.number('p_not_valid').mapV( o => o *30)
  },
  queryRules: {
    id: v.number('q_not_valid').mapV( o => o *30)
  }

});
