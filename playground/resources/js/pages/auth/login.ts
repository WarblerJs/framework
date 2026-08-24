import { FormBuilder,page } from "@warblerjs/frontend";

page("login", () => {
    console.log('Login page dev')
 

const loginForm = FormBuilder(
  "login-form",
  (v) => ({
    email: [
      "bellib6@gmail.com",
      v.required("Email is required"),
      v.email("Enter a valid email"),
    ],
    password: [
      "",
      v.required("Password is required"),
      v.string(),
      v.minLength(8, "Password must contain at least 8 characters"),
    ],

     remember: [false, v.boolean()],
  }),
//   {
//     validators: (v) => [
//       v.match("password", "confirmPassword", "Passwords do not match"),
//     ],
//   },
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
    // 1. Select the form element from the DOM
    const form = document.getElementById("login-form");

});


});
