import { defineHandler } from "@warbler/core";
import {
  JsonRes,
  type AppRequest,
} from "@warbler/http";

import { testValidator } from "../../../test.validator";
import { validateRequest } from "../validators/test.validators";
import { guestGuardTest } from "../../guards/is-admin.guard";
import { authMiddleware } from "src/shared/middlewares/scope.middleware";
import { GetUserUseCase } from "../../../application/use-case/user.use-case";

export const getTest = defineHandler({
  useCase: { getUser: GetUserUseCase},
  validator: validateRequest,
  guards: [ guestGuardTest ],
  middlewares: [ authMiddleware ],
  run: async (_ctx: AppRequest<typeof validateRequest>,{getUser}) => {

   return  JsonRes({ pp: _ctx.query })
   // const res = await getUser.execute();

    // return res.match({
    //   right: ( c) => JsonRes({ pp: _ctx.body }),
    //   left: ( d) => JsonRes({  error: d }),
    // })


  },
});

export const postTest = defineHandler({
  validator: testValidator,

  guards: [],
  middlewares: [],

  run: (ctx: AppRequest) => {
    return JsonRes({
      success: true,
      method: "POST",
      body: ctx.body,
      q: ctx.query,
      p: ctx.params,
    });
  },
});
