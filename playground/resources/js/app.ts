document.documentElement.dataset.warbler = "ready";

const socket = new WebSocket("ws://192.168.1.3:3001/chat");

socket.addEventListener("open", () => {
  console.log("Connected");

  socket.send(JSON.stringify({ event: "ping", data: {} }));
  socket.send(JSON.stringify({ event: "room.join", data: { roomId: "general" } }));
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  console.log(message);

  if (message.event === "room.joined") {
    socket.send(JSON.stringify({
      event: "chat.message",
      data: { roomId: message.data.roomId, content: "hello from the browser" },
    }));
  }
});

socket.addEventListener("close", () => {
  console.log("Disconnected");
});

socket.addEventListener("error", (error) => {
  console.error(error);
});
