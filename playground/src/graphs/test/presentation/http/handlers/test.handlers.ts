import { defineHandler } from "@warbler/framework";
import {
  JsonRes,
  type AppRequest,
} from "@warbler/framework";

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

    const source = await getUser.execute(_ctx.query.id);

    return source.match({
      right: ( c) => JsonRes({ pp: _ctx.context, vbn:c  }),
      left: ( d) => JsonRes({  error: d }),
    });


  },
});

export const postTest = defineHandler({
  validator: testValidator,

  guards: [],
  middlewares: [],

  run: (ctx: AppRequest) => {
    return JsonRes({
      q: ctx.query,
      p: ctx.params,
      h: ctx.headers,
      body: ctx.body,
    });
  },
});
