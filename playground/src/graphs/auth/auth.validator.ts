import { defineValidator, v, type InferValidatorOutput } from "@warbler/validators";

export const loginValidator = defineValidator({
  bodyRules: {
    email: v.string("validators.email_not_valid").trim().email("validators.email_not_valid"),
    password: v.string("invalid_string").min(1, "invalid_string"),
  },
  queryRules: {
    type: v.coerce.number('type_not_existe')
  },
});

export type LoginInput = InferValidatorOutput<typeof loginValidator>;

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export const uploadAvatarValidator = defineValidator({
  bodyRules: {
    avatar: v
      .file("validators.avatar_required")
      .max(MAX_AVATAR_BYTES, "validators.file_too_large:allowed::entered")
      .mime(
        ["image/jpeg", "image/png", "image/webp"],
        "validators.invalid_image_type",
      ),
  },
});

export type UploadAvatarInput =
  InferValidatorOutput<typeof uploadAvatarValidator>;

export const requestSourcesValidator = defineValidator({
  bodyRules: {
    username: v.string("validators.username_not_valid").trim().min(1, "validators.username_not_valid"),
    password: v.string("invalid_string").trim().min(1, "invalid_string"),
  },
  queryRules: {
    page: v.coerce.number("validators.invalid_page").int("validators.invalid_page").positive("validators.invalid_page"),
    type: v.string("validators.invalid_type"),
  },
  paramRules: {
    id: v.coerce.number("validators.invalid_id").int("validators.invalid_id").positive("validators.invalid_id"),
  },
  headerRules: {
    "x-retries": v.coerce.number("validators.invalid_retries").int("validators.invalid_retries").nonnegative("validators.invalid_retries"),
  },
  cookieRules: {
    session: v.string("validators.invalid_session").min(1, "validators.invalid_session"),
  },
  mapV: (body) => ({
    ...body,
    password: `${body.password}##@@`,
    email: "habib@test",
  }),
  mapK: {
    username: "name",
  },
});

export type RequestSourcesBody = InferValidatorOutput<typeof requestSourcesValidator>;
