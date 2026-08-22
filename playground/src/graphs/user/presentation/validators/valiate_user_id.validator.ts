import { defineValidator, v } from "@warbler/validators";
import { view } from "@warbler/http";

export const valiateUserID = defineValidator({
  paramRules: {
    id: v.uuid('id_invalid_uuid')
  },
  // headerRules: {
  //   "x-retries": v.coerce.number("validators.invalid_retries").int("validators.invalid_retries").nonnegative("validators.invalid_retries"),
  // },
  onValidationError(req, errors) {
    const [firstIssue] = Object.values(errors).flat();
    return view("user.invalid-id", {
      title: "Invalid user id",
      id: String(req.params.id ?? ""),
      message: firstIssue?.message.key ?? "invalid_request",
    });
  },
});
