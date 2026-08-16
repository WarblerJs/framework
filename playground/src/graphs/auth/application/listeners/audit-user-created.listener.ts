import { listen } from "@warbler/events";
import { UserCreated } from "../../domain/events/user-created.event";

export const auditUserCreated = listen(UserCreated, (event) => {
  console.log("audit.user.created", event.userId);
});
