import { inject } from "@warbler/core";
import { listen } from "@warbler/events";
import { SocketPublisher } from "@warbler/websocket";
import { UserCreated } from "../../domain/events/user-created.event";

export const notifyUserCreated = listen(UserCreated, (event) => {
  const sockets = inject(SocketPublisher);
  sockets.publish("notifications", {
    event: "user.created",
    data: { userId: event.userId, email: event.email },
  });
});
