const { Server } = require("socket.io");
const http = require("http");

const PORT = process.env.PORT || 8000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebRTC Signaling Server is Running\n');
});

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
});

const emailToSocketIdMap = new Map();
const socketIdToEmailMap = new Map();
const socketIdToRoomMap = new Map();
const roomToHostMap = new Map();
const roomLockedMap = new Map(); // Lưu trạng thái khóa của phòng

io.on("connection", (socket) => {
  console.log(`✅ Connected: ${socket.id}`);

  socket.on("room:join", (data) => {
    const { email, room } = data;

    // Kiểm tra xem phòng có đang bị khóa không
    if (roomLockedMap.get(room)) {
      socket.emit("room:error", { message: "This room is locked by the host." });
      return;
    }

    // Clean ghost users
    const oldId = emailToSocketIdMap.get(email);
    if (oldId) {
      const oldRoom = socketIdToRoomMap.get(oldId);
      if (oldRoom) io.to(oldRoom).emit("user:left", { id: oldId, email });
    }

    emailToSocketIdMap.set(email, socket.id);
    socketIdToEmailMap.set(socket.id, email);
    socketIdToRoomMap.set(socket.id, room);

    socket.join(room);

    // Host Logic: Người đầu tiên là Host
    const clientsInRoom = io.sockets.adapter.rooms.get(room);
    if (clientsInRoom.size === 1) {
      roomToHostMap.set(room, socket.id);
      socket.emit("host:status", { isHost: true });
    } else {
      socket.emit("host:status", { isHost: false });
    }

    // Gửi danh sách user cũ cho người mới
    const existingUsers = [];
    clientsInRoom.forEach(id => {
      if (id !== socket.id) existingUsers.push({ id, email: socketIdToEmailMap.get(id) });
    });

    socket.emit("room:joined", { email, room, existingUsers, isHost: roomToHostMap.get(room) === socket.id, isLocked: !!roomLockedMap.get(room) });
    socket.to(room).emit("user:joined", { email, id: socket.id });
  });

  socket.on("room:lock", ({ room, lock }) => {
    if (roomToHostMap.get(room) === socket.id) {
      roomLockedMap.set(room, lock);
      io.to(room).emit("room:locked", { lock });
    }
  });

  socket.on("user:call", ({ to, offer }) => {
    io.to(to).emit("incoming:call", { from: socket.id, offer, fromEmail: socketIdToEmailMap.get(socket.id) });
  });

  socket.on("call:accepted", ({ to, ans }) => {
    io.to(to).emit("call:accepted", { from: socket.id, ans });
  });

  socket.on("peer:candidate", ({ to, candidate }) => {
    io.to(to).emit("peer:candidate", { from: socket.id, candidate });
  });

  // Kick logic
  socket.on("user:kick", ({ to, room }) => {
    if (roomToHostMap.get(room) === socket.id) {
      io.to(to).emit("user:kicked", { room });
    }
  });

  const handleLeave = (socket, room) => {
    const email = socketIdToEmailMap.get(socket.id);
    socket.to(room).emit("user:left", { id: socket.id, email });

    // Transfer Host if needed
    if (roomToHostMap.get(room) === socket.id) {
      const clients = Array.from(io.sockets.adapter.rooms.get(room) || []).filter(id => id !== socket.id);
      if (clients.length > 0) {
        roomToHostMap.set(room, clients[0]);
        io.to(clients[0]).emit("host:status", { isHost: true });
      } else {
        roomToHostMap.delete(room);
      }
    }
    socket.leave(room);
  };

  socket.on("user:leaving", ({ room }) => handleLeave(socket, room));

  socket.on("disconnecting", () => {
    socket.rooms.forEach(room => {
      if (room !== socket.id) handleLeave(socket, room);
    });
  });

  socket.on("disconnect", () => {
    const email = socketIdToEmailMap.get(socket.id);
    emailToSocketIdMap.delete(email);
    socketIdToEmailMap.delete(socket.id);
    socketIdToRoomMap.delete(socket.id);
  });
});

server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));