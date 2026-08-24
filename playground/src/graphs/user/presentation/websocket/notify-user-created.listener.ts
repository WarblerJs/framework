import { inject } from "@warblerjs/framework";
import { listen } from "@warblerjs/events";
import { SocketPublisher } from "@warblerjs/framework";
import { UserCreated } from "../../domain/events/user-created.event";

export const notifyUserCreated = listen(UserCreated, (event) => {
  const sockets = inject(SocketPublisher);
  sockets.publish("notifications", {
    event: "user.created",
    data: { userId: event.userId, email: event.email },
  });
});
