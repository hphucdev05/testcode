import React, { createContext } from "react";
import { useContext } from "react";
import { useMemo } from "react";
import io from "socket.io-client";

// context create
const SocketContext = createContext(null);

export const useSocket = () => {
  const socket = useContext(SocketContext);
  return socket;
};

console.log(import.meta.env.VITE_API_BASE_URL);

// Provider function to provide socketContext value to children
export const SocketProvider = ({ children }) => {
  const socket = useMemo(() => {
    const envUrl = import.meta.env.VITE_API_BASE_URL;

    // Tuyệt chiêu: Tự động nhận diện IP để Demo không bị lỗi
    // Nếu URL đang là localhost hoặc một IP LAN, ta sẽ ưu tiên dùng hostname hiện tại của trình duyệt
    const isLocal = envUrl.includes('localhost') || envUrl.includes('127.0.0.1') || envUrl.match(/\d+\.\d+\.\d+\.\d+/);

    let socketUrl = envUrl;
    if (isLocal) {
      const dynamicHostname = window.location.hostname;
      socketUrl = `http://${dynamicHostname}:8000`;
      console.log("🔗 Dynamic Socket Connection to:", socketUrl);
    }

    return io(socketUrl);
  }, []);

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
};
