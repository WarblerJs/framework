 
 


// Initialize WebSocket connection
const socket = new WebSocket("ws://192.168.1.100:3001/chat");

socket.addEventListener("open", () => {
  console.log("Connected");

  socket.send(JSON.stringify({ event: "ping", data: {} }));
  socket.send(JSON.stringify({ event: "room.join", data: { roomId: "general" } }));
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  console.log(message);

  if (message.event === "room.joined") {
    joinRoomAndChat(message.data.roomId)
    socket.send(JSON.stringify({
      event: "chat.message",
      data: { roomId: message.data.roomId, content: "hello from the browser" },
    }));
  }

  console.log('message',message)

  if (message.event === "chat.message.created") {
    // socket.send(JSON.stringify({
    //   event: "chat.message",
    //   data: { roomId: message.data.roomId, content: "hello from the browser" },
    // }));
    console.log('Recived from socket',message.data.content)
    // message.data.content
    const htmlString = `
      <div class="bg-gray-50 border-b border-gray-200 p-2">
        <div>${message.data.id}</div>
        <div>${message.data.content}</div>
      </div>
    `;
    document.getElementById('content-msg')?.insertAdjacentHTML('beforeend', htmlString);
  }
});

socket.addEventListener("close", () => {
  console.log("Disconnected");
});

socket.addEventListener("error", (error) => {
  console.error(error);
});


// FIXED: Cast to HTMLInputElement to access input-specific properties
function joinRoomAndChat(roomId:string) {
  const btn = document.getElementById('sub') as HTMLInputElement | null;
if( btn ) {
  btn.addEventListener('click' ,() => {
    const input = document.getElementById('input-text') as HTMLInputElement;

    if( input.value.trim().length > 0 ) {
      socket.send(JSON.stringify({
        event: "chat.message",
        data: { roomId ,content: input.value.trim() },
      })); 
    }
  })
}
}