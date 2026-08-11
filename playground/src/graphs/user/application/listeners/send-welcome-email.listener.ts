import { inject } from "@warbler/core";
import { Email } from "@warbler/email";
import { listen } from "@warbler/events";
import { UserCreated } from "../../domain/events/user-created.event";

export const sendWelcomeEmail = listen(UserCreated, async (event) => {
  const email = inject(Email);
  await email.send({
    to: event.email,
    subject: "Welcome to Warbler",
    template: "mail.welcome",
    data: Object.freeze({ email: event.email, userId: event.userId }),
  });
});
