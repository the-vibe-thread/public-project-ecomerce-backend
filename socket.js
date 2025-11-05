import { Server } from "socket.io";

let io;

export const initializeSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: [
                "https://adminpanel-ruby-seven.vercel.app",
                "https://frontend-xodi.vercel.app",
            ],
            methods: ["GET", "POST"],
            credentials: true
        }
    });

    io.on("connection", (socket) => {
        console.log(`🟢 New client connected: ${socket.id}`);

        socket.on("disconnect", () => {
            console.log(`🔴 Client disconnected: ${socket.id}`);
        });
    });

    return io;
};

export const getIoInstance = () => {
    if (!io) {
        throw new Error("Socket.IO has not been initialized.");
    }
    return io;
};
