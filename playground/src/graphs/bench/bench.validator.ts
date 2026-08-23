import { defineValidator, v } from "@warbler/validators";

export const benchValidator = defineValidator({
  queryRules: {
    id: v.string('id_invalid_uuid')
  },
  // headerRules: {
  //   "x-retries": v.number("validators.invalid_retries").int("validators.invalid_retries").gte(0, "validators.invalid_retries"),
  // },
//   onValidationError(req, errors) {
//     const [firstIssue] = Object.values(errors).flat();
//     return view("user.invalid-id", {
//       title: "Invalid user id",
//       id: String(req.params.id ?? ""),
//       message: firstIssue?.message.key ?? "invalid_request",
//     });
//   },
});

export const optionalBenchQueryValidator = defineValidator({
  queryRules: {
    id: v.string('id_invalid_uuid').optional(),
  },
});
