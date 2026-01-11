import React, { useEffect, useRef, useState, memo, useCallback } from "react";
import { useSocket } from "../context/SocketProvider";
import { useParams } from "react-router-dom";
import PeerService from "../services/Peer";
import '../Room.css';

// Component hiển thị Video với nút Ghim
const VideoPlayer = memo(({ stream, isLocal, email, id, onPin, isPinned }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      console.log(`Setting stream for ${email}`);
      videoRef.current.srcObject = stream;

      const handlePlay = () => {
        videoRef.current.play().catch(err => console.log("Autoplay error:", err));
      };

      videoRef.current.onloadedmetadata = handlePlay;
      handlePlay();
    }
  }, [stream, email]);

  return (
    <div className={`video-wrapper ${isPinned ? 'pinned' : ''} ${!stream ? 'no-stream' : ''}`} onClick={() => onPin(id)}>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          style={isLocal ? { transform: "scaleX(-1)" } : {}}
        />
      ) : (
        <div className="camera-off">
          <span>📷</span>
          <p>Camera Disabled</p>
          {!window.isSecureContext && <small>(HTTPS Required for Mobile)</small>}
        </div>
      )}
      <div className="user-tag">
        {isPinned && <span className="pin-icon">📌 </span>}
        {email}
      </div>
      {!isPinned && stream && <div className="pin-overlay">Click to Pin</div>}
    </div>
  );
});

// Component hiển thị Thanh Progress
const ProgressItem = ({ id, name, progress, type, onCancel }) => (
  <div className={`progress-item ${type}`}>
    <div className="progress-header">
      <small>{type === 'upload' ? '📤 Sending...' : `📥 Receiving ${name}...`}</small>
      <button className="btn-close-mini" onClick={onCancel} title="Stop Transfer">×</button>
    </div>
    <div className="progress-item-inner">
      <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }}></div></div>
      <span>{progress}%</span>
    </div>
  </div>
);

const Room = () => {
  const socket = useSocket();
  const { roomId } = useParams();
  const myEmail = localStorage.getItem('userEmail') || 'Anonymous';
  const currentRoom = roomId || localStorage.getItem('currentRoom') || '1';

  const [myStream, setMyStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [pinnedId, setPinnedId] = useState('local');

  // Files & Features
  const [files, setFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState({});
  const [downloadProgress, setDownloadProgress] = useState({});
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);

  const peersRef = useRef({});
  const initialized = useRef(false);
  const fileInputRef = useRef(null);
  const outboundFilesRef = useRef({});
  const inboundBuffersRef = useRef({});

  const handlePin = (id) => setPinnedId(prev => prev === id ? null : id);

  const handleSendMessage = () => {
    const trimmedMsg = message.trim();
    if (!trimmedMsg) return;

    // Xóa ô nhập liệu NGAY LẬP TỨC để người dùng cảm thấy mượt
    setMessage("");

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const payload = JSON.stringify({ text: trimmedMsg, time });

    // Gửi cho tất cả bạn bè trong phòng
    Object.values(peersRef.current).forEach(p => {
      if (p.chatChannel?.readyState === "open") {
        p.chatChannel.send(payload);
      }
    });

    // Cập nhật giao diện của chính mình
    setMessages(prev => [...prev, {
      id: Date.now(),
      text: trimmedMsg,
      fromEmail: myEmail,
      fromSelf: true,
      time
    }]);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fileId = `file-${Date.now()}`;
    outboundFilesRef.current[fileId] = file;
    Object.values(peersRef.current).forEach(p => {
      if (p.fileChannel?.readyState === "open") {
        p.fileChannel.send(JSON.stringify({ type: "file:offer", fileId, name: file.name, size: file.size }));
      }
    });
    setFiles(prev => [...prev, { id: fileId, name: file.name, size: file.size, status: 'offered', type: 'sent', timestamp: new Date().toLocaleTimeString() }]);
    e.target.value = '';
  };

  const acceptFile = (peerId, fileId, name, size) => {
    const peer = peersRef.current[peerId];
    if (peer) {
      inboundBuffersRef.current[fileId] = { name, size, chunks: [], receivedSize: 0 };
      peer.fileChannel.send(JSON.stringify({ type: "file:request", fileId }));
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'receiving' } : f));
    }
  };

  const activeTransfers = useRef(new Set());

  const setupFileLogic = (peer, email, id) => {
    peer.fileChannel.onmessage = async (e) => {
      if (typeof e.data === 'string') {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'file:offer') {
            setFiles(prev => [...prev, {
              id: msg.fileId,
              peerId: id,
              name: msg.name,
              size: msg.size,
              status: 'pending',
              from: email,
              startTime: Date.now()
            }]);
          } else if (msg.type === 'file:request') {
            const file = Array.from(outboundFilesRef.current).find(f => f.name === msg.name);
            if (file) {
              activeTransfers.current.add(msg.fileId);
              sendFileInChunks(peer, file, msg.fileId);
            }
          } else if (msg.type === 'file:cancel') {
            activeTransfers.current.delete(msg.fileId);
            setFiles(prev => prev.filter(f => f.id !== msg.fileId));
            setDownloadProgress(prev => { const n = { ...prev }; delete n[msg.fileId]; return n; });
            setUploadProgress(prev => { const n = { ...prev }; delete n[msg.fileId]; return n; });
            delete inboundBuffersRef.current[msg.fileId];
            console.warn("🚫 Transfer canceled by remote peer");
          } else if (msg.type === 'file:complete') {
            const buffer = inboundBuffersRef.current[msg.fileId];
            if (buffer) {
              // Đảm bảo progress đạt 100% trước khi hiện nút Save
              setDownloadProgress(prev => ({ ...prev, [msg.fileId]: 100 }));

              const blob = new Blob(buffer.chunks);
              const url = URL.createObjectURL(blob);
              setFiles(prev => prev.map(f => f.id === msg.fileId ? { ...f, status: 'completed', url } : f));

              setTimeout(() => {
                setDownloadProgress(prev => { const n = { ...prev }; delete n[msg.fileId]; return n; });
                delete inboundBuffersRef.current[msg.fileId];
              }, 2000);
            }
          }
        } catch (err) { console.log("File channel raw msg:", e.data); }
      } else {
        const activeFileId = Object.keys(inboundBuffersRef.current)[0];
        if (activeFileId) {
          const buffer = inboundBuffersRef.current[activeFileId];
          buffer.chunks.push(e.data);
          buffer.receivedSize += e.data.byteLength;

          // Tính toán tiến trình thật
          const realProgress = Math.round((buffer.receivedSize / buffer.size) * 100);

          // Ép tiến trình chạy ít nhất 6 giây
          const elapsed = (Date.now() - buffer.startTime) / 6000; // Tỉ lệ thời gian trôi qua so với 6s
          const timeProgress = Math.min(Math.round(elapsed * 100), 100);

          // Lấy cái nào nhỏ hơn để thanh bar chạy chậm lại
          const displayProgress = Math.min(realProgress, timeProgress);
          setDownloadProgress(prev => ({ ...prev, [activeFileId]: displayProgress }));
        }
      }
    };
  };

  const handleCancelFile = (fileId, peerId) => {
    activeTransfers.current.delete(fileId);
    const peer = peersRef.current[peerId];
    if (peer && peer.fileChannel.readyState === "open") {
      peer.fileChannel.send(JSON.stringify({ type: 'file:cancel', fileId }));
    }
    setFiles(prev => prev.filter(f => f.id !== fileId));
    setDownloadProgress(prev => { const n = { ...prev }; delete n[fileId]; return n; });
    setUploadProgress(prev => { const n = { ...prev }; delete n[fileId]; return n; });
    delete inboundBuffersRef.current[fileId];
  };

  const sendFileInChunks = async (peer, file, fileId) => {
    const reader = file.stream().getReader();
    let sent = 0;
    const startTime = Date.now();

    try {
      while (true) {
        if (!activeTransfers.current.has(fileId)) break;
        const { done, value } = await reader.read();
        if (done) break;

        peer.fileChannel.send(value);
        sent += value.byteLength;

        const realProgress = (sent / file.size) * 100;
        const elapsed = Date.now() - startTime;
        const timeProgress = (elapsed / 6000) * 100;
        setUploadProgress(prev => ({ ...prev, [fileId]: Math.min(Math.round(realProgress), Math.round(timeProgress)) }));

        if (file.size < 500000) await new Promise(r => setTimeout(r, 100));
        else await new Promise(r => setTimeout(r, 10));
      }

      // Vòng lặp cưỡng bức chạy đủ 6 giây (6000ms)
      while (activeTransfers.current.has(fileId)) {
        const elapsed = Date.now() - startTime;
        if (elapsed >= 6000) break;
        const timeProgress = Math.round((elapsed / 6000) * 100);
        setUploadProgress(prev => ({ ...prev, [fileId]: timeProgress }));
        await new Promise(r => setTimeout(r, 100)); // Cập nhật bar mỗi 0.1s
      }

      if (activeTransfers.current.has(fileId)) {
        setUploadProgress(prev => ({ ...prev, [fileId]: 100 }));
        peer.fileChannel.send(JSON.stringify({ type: 'file:complete', fileId }));
        setTimeout(() => {
          setUploadProgress(prev => { const n = { ...prev }; delete n[fileId]; return n; });
          activeTransfers.current.delete(fileId);
        }, 1500);
      }
    } catch (err) {
      console.error("Transmission error:", err);
    }
  };

  const createPeer = useCallback((id, email, stream) => {
    const peer = new PeerService();
    if (stream) {
      stream.getTracks().forEach(track => peer.peer.addTrack(track, stream));
    }

    peer.peer.ontrack = (event) => {
      console.log("Received remote track from", email);
      setRemoteStreams(prev => {
        const existing = prev.find(p => p.id === id);
        if (existing) return prev;
        return [...prev, { id, email, stream: event.streams[0] }];
      });
    };

    peer.peer.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("peer:candidate", { candidate: event.candidate, to: id });
      }
    };

    peer.peer.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label === "chat") {
        peer.chatChannel = channel;
        channel.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            setMessages(prev => [...prev, { id: Date.now(), text: data.text, fromEmail: email, fromSelf: false, time: data.time }]);
          } catch (err) {
            setMessages(prev => [...prev, { id: Date.now(), text: e.data, fromEmail: email, fromSelf: false, time: "Now" }]);
          }
        };
      }
      if (channel.label === "file") {
        peer.fileChannel = channel;
        setupFileLogic(peer, email, id);
      }
    };

    return peer;
  }, [socket]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const startMyStream = async () => {
      console.log("🚀 Starting media stream...");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        setMyStream(stream);
        console.log("✅ Camera access granted");
      } catch (err) {
        console.warn("⚠️ Camera blocked. Reason: Most mobile browsers require HTTPS (ngrok) for camera access.", err);
        // Vẫn tiếp tục Join để test Chat/File
      }
      socket.emit("room:join", { email: myEmail, room: currentRoom });
    };

    startMyStream();

    return () => {
      if (myStream) myStream.getTracks().forEach(t => t.stop());
    };
  }, []);

  useEffect(() => {
    const handleUserJoined = async ({ email, id }) => {
      console.log("User joined:", email);
      const peer = createPeer(id, email, myStream);

      peer.chatChannel = peer.peer.createDataChannel("chat");
      peer.chatChannel.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          setMessages(prev => [...prev, { id: Date.now(), text: data.text, fromEmail: email, fromSelf: false, time: data.time }]);
        } catch (err) {
          setMessages(prev => [...prev, { id: Date.now(), text: e.data, fromEmail: email, fromSelf: false, time: "Now" }]);
        }
      };

      peer.fileChannel = peer.peer.createDataChannel("file");
      setupFileLogic(peer, email, id);

      peersRef.current[id] = peer;
      const offer = await peer.getOffer();
      socket.emit("user:call", { to: id, offer });
    };

    const handleIncomingCall = async ({ from, offer, fromEmail }) => {
      console.log("Incoming call from:", fromEmail);
      const peer = createPeer(from, fromEmail, myStream);
      peersRef.current[from] = peer;
      const answer = await peer.getAnswer(offer);
      socket.emit("call:accepted", { to: from, ans: answer });
    };

    const handleCallAccepted = async ({ from, ans }) => {
      console.log("Call accepted by:", from);
      if (peersRef.current[from]) {
        await peersRef.current[from].setLocalDescription(ans);
      }
    };

    const handlePeerCandidate = async ({ candidate, from }) => {
      if (peersRef.current[from]) {
        await peersRef.current[from].addIceCandidate(candidate);
      }
    };

    const handleUserLeft = ({ id, email }) => {
      console.log(`👋 User left: ${email || id}`);
      setRemoteStreams(prev => prev.filter(p => p.id !== id));
      if (peersRef.current[id]) {
        peersRef.current[id].peer.close();
        delete peersRef.current[id];
      }
      // Nếu người bị xóa đang được ghim, chuyển về ghim local
      setPinnedId(prev => prev === id ? 'local' : prev);
    };

    socket.on("user:joined", handleUserJoined);
    socket.on("incoming:call", handleIncomingCall);
    socket.on("call:accepted", handleCallAccepted);
    socket.on("peer:candidate", handlePeerCandidate);
    socket.on("user:left", handleUserLeft);

    return () => {
      socket.off("user:joined", handleUserJoined);
      socket.off("incoming:call", handleIncomingCall);
      socket.off("call:accepted", handleCallAccepted);
      socket.off("peer:candidate", handlePeerCandidate);
      socket.off("user:left", handleUserLeft);
    };
  }, [socket, myStream, createPeer]);

  const pStream = pinnedId === 'local' ? { stream: myStream, email: "You", id: 'local' } : remoteStreams.find(r => r.id === pinnedId);
  const otherStreams = [{ stream: myStream, email: "You", id: 'local' }, ...remoteStreams].filter(s => s.id !== pinnedId);

  return (
    <div className="room-container">
      <header className="room-header">
        <h1>Room: {currentRoom}</h1>
        <div className="connection-status">👤 {myEmail} | 👥 {remoteStreams.length + 1} users</div>
      </header>
      <main className="main-content">
        <div className="video-section">
          <div className="controls-bar">
            <button className="btn-control" onClick={() => { }}>Screen</button>
            <button className="btn-control" onClick={() => { }}>Record</button>
            <button className="btn-control" onClick={() => fileInputRef.current?.click()}>📁 File</button>
            <input ref={fileInputRef} type="file" onChange={handleFileSelect} style={{ display: 'none' }} />
            <div className="status-progress-container">
              {Object.entries(uploadProgress).map(([fileId, p]) => (
                <ProgressItem
                  key={fileId}
                  progress={p}
                  type="upload"
                  onCancel={() => {
                    // Cần tìm peerId cho file này
                    const f = files.find(f => f.id === fileId);
                    if (f) handleCancelFile(fileId, f.peerId);
                  }}
                />
              ))}
              {Object.entries(downloadProgress).map(([name, p]) => {
                const f = files.find(f => f.name === name && f.status !== 'completed');
                return (
                  <ProgressItem
                    key={name}
                    name={name}
                    progress={p}
                    type="download"
                    onCancel={() => f && handleCancelFile(f.id, f.peerId)}
                  />
                );
              })}
            </div>
          </div>
          <div className={`video-layout ${pinnedId ? 'spotlight' : 'grid'}`}>
            {pinnedId && pStream && (
              <div className="pinned-video-container">
                <VideoPlayer stream={pStream.stream} isLocal={pStream.id === 'local'} email={`${pStream.email} (Pinned)`} id={pStream.id} onPin={handlePin} isPinned={true} />
              </div>
            )}
            <div className="side-videos-grid">
              {otherStreams.map(s => (
                <VideoPlayer key={s.id} stream={s.stream} isLocal={s.id === 'local'} email={s.email} id={s.id} onPin={handlePin} isPinned={false} />
              ))}
            </div>
          </div>
        </div>
        <aside className="side-panel">
          <div className="chat-box">
            <div className="panel-header">💬 Chat</div>
            <div className="chat-messages">{messages.map(m => (
              <div key={m.id} className={`chat-message ${m.fromSelf ? 'self' : 'other'}`}>
                {!m.fromSelf && <small>{m.fromEmail}</small>}
                <p>{m.text}</p><div className="message-time">{m.time}</div>
              </div>
            ))}</div>
            <div className="chat-input-wrapper">
              <input value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} placeholder="Type..." />
              <button className="btn-send" onClick={handleSendMessage}>Send</button>
            </div>
          </div>
          <div className="file-panel">
            <div className="panel-header">📂 P2P Files</div>
            <div className="file-list">{files.map(f => (
              <div key={f.id} className="file-item">
                <div className="file-info"><span className="file-name">{f.name}</span><small>{f.status}</small></div>
                {f.status === 'pending' && <button className="btn-send" onClick={() => acceptFile(f.peerId, f.id, f.name, f.size)}>Accept</button>}
                {f.status === 'completed' && f.url && <a href={f.url} download={f.name} className="dl-btn">💾</a>}
              </div>
            ))}</div>
          </div>
        </aside>
      </main>
    </div>
  );
};

export default Room;