import { inject } from "@warbler/framework";
import { listen } from "@warbler/events";
import { SocketPublisher } from "@warbler/framework";
import { UserCreated } from "../../domain/events/user-created.event";

export const notifyUserCreated = listen(UserCreated, (event) => {
  const sockets = inject(SocketPublisher);
  sockets.publish("notifications", {
    event: "user.created",
    data: { userId: event.userId, email: event.email },
  });
});
