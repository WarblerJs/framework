# Examples

```ts
export const notifyUserCreated = listen(UserCreated, (event) => {
  const sockets = inject(SocketPublisher);
  sockets.publish("notifications", {
    event: "user.created",
    data: { userId: event.userId, email: event.email },
  });
});
```

`@warbler/events` does not manage sockets, rooms, WebSocket connections, mail transports, or database
clients. Those are listener consumers. WebSocket fan-out stays in `@warbler/websocket` and Bun native
pub/sub through `SocketPublisher`.
