import { listen } from "@warbler/events";
import { UserCreated } from "../../domain/events/user-created.event";

export const sendWelcomeEmail = listen(UserCreated, (event) => {
  console.log("welcome.email", event.email);
});
