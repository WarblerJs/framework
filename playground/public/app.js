// resources/js/app.ts
document.documentElement.dataset.warbler = "ready";
var socket = new WebSocket("ws://192.168.1.3:3001/chat");
socket.addEventListener("open", () => {
  console.log("Connected");
  socket.send(JSON.stringify({ event: "ping", data: {} }));
  socket.send(JSON.stringify({ event: "room.join", data: { roomId: "general" } }));
});
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  console.log(message);
  if (message.event === "room.joined") {
    joinRoomAndChat(message.data.roomId);
    socket.send(JSON.stringify({
      event: "chat.message",
      data: { roomId: message.data.roomId, content: "hello from the browser" }
    }));
  }
  console.log("message", message);
  if (message.event === "chat.message.created") {
    console.log("Recived from socket", message.data.content);
    const htmlString = `
      <div class="bg-gray-50 border-b border-gray-200 p-2">
        <div>${message.data.id}</div>
        <div>${message.data.content}</div>
      </div>
    `;
    document.getElementById("content-msg")?.insertAdjacentHTML("beforeend", htmlString);
  }
});
socket.addEventListener("close", () => {
  console.log("Disconnected");
});
socket.addEventListener("error", (error) => {
  console.error(error);
});
function joinRoomAndChat(roomId) {
  const btn = document.getElementById("sub");
  if (btn) {
    btn.addEventListener("click", () => {
      const input = document.getElementById("input-text");
      if (input.value.trim().length > 0) {
        socket.send(JSON.stringify({
          event: "chat.message",
          data: { roomId, content: input.value.trim() }
        }));
      }
    });
  }
}

//# debugId=FAC701829FF19FFF64756E2164756E21
