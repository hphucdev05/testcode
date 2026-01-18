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
const lockedRooms = new Set(); // Lưu danh sách phòng bị khoá

io.on("connection", (socket) => {
    socket.on("room:join", (data) => {
        const { email, room } = data;

        // 1. Kiểm tra nếu phòng đang bị khoá
        if (lockedRooms.has(room)) {
            const hostId = roomToHostMap.get(room);
            if (socket.id !== hostId) {
                // Gửi yêu cầu xin vào cho Host
                io.to(hostId).emit("room:knock", {
                    email,
                    room,
                    requesterId: socket.id
                });
                // Thông báo cho người xin vào rằng đang chờ
                socket.emit("room:waiting", { message: "Waiting for host approval..." });
                return; // Dừng lại, chờ Host phản hồi
            }
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

        // Host Logic
        const clientsInRoom = io.sockets.adapter.rooms.get(room);
        if (clientsInRoom.size === 1) {
            roomToHostMap.set(room, socket.id);
            socket.emit("host:status", { isHost: true });
        } else {
            socket.emit("host:status", { isHost: false, isLocked: lockedRooms.has(room) });
        }

        const existingUsers = [];
        clientsInRoom.forEach(id => {
            if (id !== socket.id) existingUsers.push({ id, email: socketIdToEmailMap.get(id) });
        });

        socket.emit("room:joined", { email, room, existingUsers, isHost: roomToHostMap.get(room) === socket.id });
        socket.to(room).emit("user:joined", { email, id: socket.id });
    });

    // LOCK / UNLOCK
    socket.on("room:lock", ({ room }) => {
        if (roomToHostMap.get(room) === socket.id) {
            lockedRooms.add(room);
            io.to(room).emit("room:locked", { status: true });
        }
    });

    socket.on("room:unlock", ({ room }) => {
        if (roomToHostMap.get(room) === socket.id) {
            lockedRooms.delete(room);
            io.to(room).emit("room:locked", { status: false });
        }
    });

    socket.on("user:kick", ({ to, room }) => {
        if (roomToHostMap.get(room) === socket.id) {
            io.to(to).emit("user:kicked", { room });
        }
    });

    // Host phản hồi yêu cầu vào phòng
    socket.on("room:approve", ({ requesterId, room }) => {
        if (roomToHostMap.get(room) === socket.id) {
            io.to(requesterId).emit("room:approved", { room });
        }
    });

    socket.on("room:deny", ({ requesterId, room }) => {
        if (roomToHostMap.get(room) === socket.id) {
            io.to(requesterId).emit("room:error", { message: "Host denied your request to join." });
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

    const handleLeave = (socket, room) => {
        const email = socketIdToEmailMap.get(socket.id);
        socket.to(room).emit("user:left", { id: socket.id, email });

        if (roomToHostMap.get(room) === socket.id) {
            const clients = Array.from(io.sockets.adapter.rooms.get(room) || []).filter(id => id !== socket.id);
            if (clients.length > 0) {
                roomToHostMap.set(room, clients[0]);
                io.to(clients[0]).emit("host:status", { isHost: true });
            } else {
                roomToHostMap.delete(room);
                lockedRooms.delete(room); // Xóa lock nếu phòng trống
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
        if (email) emailToSocketIdMap.delete(email);
        socketIdToEmailMap.delete(socket.id);
        socketIdToRoomMap.delete(socket.id);
    });
});

server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));