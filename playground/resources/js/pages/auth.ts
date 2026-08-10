import { FormBuilder } from "@warbler/frontend/forms";

const loginForm = FormBuilder(
  "login-form",
  (v) => ({
    email: [
      "test@example.com",
      v.required("Email is required"),
      v.email("Enter a valid email"),
    ],
    password: [
      "",
      v.required("Password is required"),
      v.string(),
      v.minLength(8, "Password must contain at least 8 characters"),
    ],
    confirmPassword: [
      "",
      v.required("Confirm your password"),
    ],
    remember: [false, v.boolean()],
  }),
  {
    validators: (v) => [
      v.match("password", "confirmPassword", "Passwords do not match"),
    ],
  },
);

// loginForm.field("email").onInput((value) => {
//   console.log("email:", value);
// });

// loginForm.onChange((value) => {
//   console.log("form:", value);
// });

// loginForm.onSubmit((value) => {
//   console.log("submit:", value);
// });

// loginForm.onSuccess((response) => {
//   console.log("login response:", response.status);
// });

// loginForm.onError((error) => {
//   console.error("login failed:", error);
// });

loginForm.onSubmit((value) => {
  console.log("submit:", value);
});
