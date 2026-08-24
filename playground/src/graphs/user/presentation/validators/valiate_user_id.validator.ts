import { defineValidator, v, type ValidationErrors, type ValidationIssue, type ValidationRequest } from "@warbler/framework";
import { view } from "@warbler/framework";

function firstIssue(errors: ValidationErrors): ValidationIssue | undefined {
  const groups = Object.values(errors);
  for (let index = 0; index < groups.length; index += 1) {
    const issue = groups[index]?.[0];
    if (issue !== undefined) return issue;
  }
  return undefined;
}

export const valiateUserID = defineValidator({
  paramRules: {
    id: v.uuid('id_invalid_uuid')
  },
  // headerRules: {
  //   "x-retries": v.number("validators.invalid_retries").int("validators.invalid_retries").gte(0, "validators.invalid_retries"),
  // },
  onValidationError(req: ValidationRequest, errors: ValidationErrors) {
    const issue = firstIssue(errors);
    return view("user.invalid-id", {
      title: "Invalid user id",
      id: String(req.params.id ?? ""),
      message: issue?.message.key ?? "invalid_request",
    });
  },
});
