import { inject } from "@warbler/core";
import { Email } from "@warbler/email";
import { listen } from "@warbler/events";
import { UserCreated } from "../../domain/events/user-created.event";

export const sendWelcomeEmail = listen(UserCreated, async (event) => {
  console.log('register...')
  const email = inject(Email);
  await email.send({
    to: event.email,
    subject: "Welcome to Warbler",
    text: `Welcome to Warbler. Your account is ready: ${event.email}. User id: ${event.userId}.`,
    template: "mail.welcome",
    data: Object.freeze({ email: event.email, userId: event.userId }),
  });
});
