import React, { useEffect, useRef, useState, memo, useCallback } from "react";
import { useSocket } from "../context/SocketProvider";
import { useParams, useNavigate } from "react-router-dom";
import PeerService from "../services/Peer";
import '../Room.css';

// Xóa bỏ logic reload check cũ kỹ gây lỗi
// let reloadHandled = false; 

const formatBytes = (bytes, decimals = 2) => {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

const VideoPlayer = memo(({ stream, isLocal, email, id, onPin, isPinned }) => {
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => console.error("Video play error:", e));
    }
  }, [stream]);

  return (
    <div className={`video-wrapper ${isPinned ? 'pinned' : ''} ${!stream ? 'no-stream' : ''}`} onClick={() => onPin(id)}>
      {stream ? (
        <video ref={videoRef} autoPlay playsInline muted={isLocal} style={isLocal ? { transform: "scaleX(-1)" } : {}} />
      ) : (
        <div className="camera-off"><span>📷</span><p>{isLocal ? "My Camera" : "Connecting..."}</p></div>
      )}
      <div className="user-tag">{isPinned && "📌 "}{email}</div>
    </div>
  );
});

const ProgressItem = ({ id, name, progress, type, status, onCancel }) => (
  <div className={`progress-item ${type} ${status}`}>
    <div className="progress-header">
      <small>
        {status === 'cancelled' ? '❌ Cancelled' :
          status === 'completed' ? '✅ Completed' :
            progress === 100 ? '✅ Done' :
              type === 'upload' ? '📤 Sending...' : `📥 Receiving ${name}...`}
      </small>
      {status !== 'cancelled' && status !== 'completed' && progress !== 100 && (
        <button className="btn-close-mini" onClick={onCancel} title="Cancel Transfer">×</button>
      )}
    </div>
    <div className="progress-item-inner">
      <div className="progress-bar">
        <div className={`progress-fill ${status === 'cancelled' ? 'cancelled-bar' : ''}`} style={{ width: `${progress}%` }}></div>
      </div>
      <span>{progress}%</span>
    </div>
  </div>
);

const Room = () => {
  const socket = useSocket();
  const navigate = useNavigate();
  // KHỚP TÊN THAM SỐ VỚI APP.JSX (/room/:roomID)
  const { roomID } = useParams();
  const myEmail = localStorage.getItem('userEmail') || 'Anonymous';
  // Nếu không có roomID (trường hợp hiếm), mới fallback về '1'
  const currentRoom = roomID || '1';

  const [myStream, setMyStream] = useState(null);
  const myStreamRef = useRef(null);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [pinnedId, setPinnedId] = useState('local');

  // File State
  const [files, setFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState({});
  const [downloadProgress, setDownloadProgress] = useState({});

  // Feature State
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);

  // Refs
  const peersRef = useRef({});
  const fileInputRef = useRef(null);
  const outboundFilesRef = useRef({});
  const inboundBuffersRef = useRef({});
  const activeTransfers = useRef(new Set());
  const progressTimers = useRef({});

  const handlePin = (id) => setPinnedId(prev => (prev === id ? null : id));

  const handleLeaveRoom = () => {
    // 1. Nhã hết track media
    if (myStreamRef.current) {
      myStreamRef.current.getTracks().forEach(track => track.stop());
    }
    // 2. Đóng kết nối Peer
    Object.values(peersRef.current).forEach(p => p.peer.close());

    // 3. Thông báo server
    socket.emit("user:leaving", { room: currentRoom });
    console.log("👋 Sending leave signal...");

    // 4. Force Reload về trang chủ sau 500ms để đảm bảo Server nhận được tin
    setTimeout(() => {
      window.location.href = "/";
    }, 500);
  };

  // --- SCREEN SHARE ---
  const handleScreenShare = async () => {
    try {
      if (!isScreenSharing) {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const videoTrack = stream.getVideoTracks()[0];

        Object.values(peersRef.current).forEach(p => {
          const sender = p.peer.getSenders().find(s => s.track.kind === 'video');
          if (sender) sender.replaceTrack(videoTrack);
        });

        videoTrack.onended = () => { stopScreenShare(); };
        setIsScreenSharing(true);
      } else {
        stopScreenShare();
      }
    } catch (err) { console.error("Screen share error:", err); }
  };

  const stopScreenShare = () => {
    if (myStreamRef.current) {
      const originalTrack = myStreamRef.current.getVideoTracks()[0];
      Object.values(peersRef.current).forEach(p => {
        const sender = p.peer.getSenders().find(s => s.track.kind === 'video');
        if (sender) sender.replaceTrack(originalTrack);
      });
    }
    setIsScreenSharing(false);
  };

  // --- RECORDING ---
  const startRecording = () => {
    const chunks = [];
    const tracks = [...(myStreamRef.current?.getTracks() || []), ...remoteStreams.flatMap(s => s.stream.getTracks())];
    if (tracks.length === 0) return;
    const stream = new MediaStream(tracks);
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recording-${Date.now()}.webm`;
      a.click();
    };
    recorder.start();
    setMediaRecorder(recorder);
    setIsRecording(true);
  };
  const stopRecording = () => { mediaRecorder?.stop(); setIsRecording(false); };

  // --- CHAT LOGIC ---
  const handleSendMessage = () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const payload = JSON.stringify({ text: trimmed, time });

    Object.values(peersRef.current).forEach(p => {
      if (p.chatChannel && p.chatChannel.readyState === "open") p.chatChannel.send(payload);
    });

    setMessages(prev => [...prev, { id: Date.now(), text: trimmed, fromEmail: myEmail, fromSelf: true, time }]);
    setMessage("");
  };

  // --- FILE TRANSFER ---
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // --- SAFETY CHECK: 1GB LIMIT ---
    // Ngăn chặn Crash do tràn RAM (Browser OOM Limit ~1.4GB)
    const MAX_SIZE = 1 * 1024 * 1024 * 1024; // 1 GB
    if (file.size > MAX_SIZE) {
      alert(`⚠️ File quá lớn (${formatBytes(file.size)})! Trình duyệt giới hạn dưới 1GB để tránh tràn bộ nhớ RAM.`);
      e.target.value = ""; // Reset input
      return;
    }
    // --------------------------------

    fileInputRef.current.value = "";

    const fileId = `file-${Date.now()}`;
    outboundFilesRef.current[fileId] = file;

    // --- DEMO EVIDENCE: SENDER SIDE ---
    console.log(`%c [P2P Sender] 📤 File Loaded into Memory Reference!`, 'color: #ff9900; font-weight: bold;');
    console.log(`📄 Name: ${file.name}`);
    console.log(`📦 Size: ${formatBytes(file.size)}`);
    // ----------------------------------

    let sentCount = 0;
    Object.values(peersRef.current).forEach(p => {
      if (p.fileChannel && p.fileChannel.readyState === "open") {
        try {
          p.fileChannel.send(JSON.stringify({ type: "file:offer", fileId, name: file.name, size: file.size }));
          sentCount++;
        } catch (err) { console.error("Send Offer Error", err); }
      }
    });

    if (sentCount === 0 && Object.keys(peersRef.current).length > 0) console.warn("Waiting for channels...");

    setFiles(prev => [...prev, { id: fileId, name: file.name, size: file.size, status: 'offered', type: 'sent' }]);
  };

  const handleCancelFile = (fileId) => {
    const file = files.find(f => f.id === fileId);
    if (!file) {
      activeTransfers.current.delete(fileId);
      return;
    }

    if (file.type === 'sent') {
      const keys = [...activeTransfers.current];
      keys.forEach(k => { if (k.startsWith(fileId)) activeTransfers.current.delete(k); });

      Object.values(peersRef.current).forEach(p => {
        if (p.fileChannel && p.fileChannel.readyState === "open") {
          try { p.fileChannel.send(JSON.stringify({ type: "file:cancel", fileId })); } catch (e) { }
        }
      });

      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'cancelled' } : f));
      setUploadProgress(prev => { let n = { ...prev }; delete n[fileId]; return n; });

    } else {
      const peerId = file.peerId;
      const transferKey = `${fileId}-${peerId}`;
      activeTransfers.current.delete(transferKey);

      if (progressTimers.current[fileId]) {
        clearInterval(progressTimers.current[fileId]);
        delete progressTimers.current[fileId];
      }

      if (peerId && peersRef.current[peerId]) {
        const p = peersRef.current[peerId];
        if (p.fileChannel && p.fileChannel.readyState === "open") {
          try { p.fileChannel.send(JSON.stringify({ type: "file:cancel", fileId })); } catch (e) { }
        }
      }

      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'cancelled' } : f));

      setDownloadProgress(prev => { let n = { ...prev }; delete n[fileId]; return n; });
      delete inboundBuffersRef.current[fileId];
    }
  };

  const setupFileLogic = (peer, email, id) => {
    peer.fileChannel.onmessage = (e) => {
      handleFileChannelMessage(e, peer, email, id);
    };
  };

  const handleFileChannelMessage = async (e, peer, email, id) => {
    if (typeof e.data === 'string') {
      try {
        const msg = JSON.parse(e.data);

        if (msg.type === 'file:offer') {
          setFiles(prev => {
            if (prev.find(f => f.id === msg.fileId)) return prev;
            return [...prev, { id: msg.fileId, peerId: id, name: msg.name, size: msg.size, status: 'pending', from: email, type: 'received' }];
          });

        } else if (msg.type === 'file:request') {
          const file = outboundFilesRef.current[msg.fileId];
          if (file) {
            const transferKey = `${msg.fileId}-${id}`;
            activeTransfers.current.add(transferKey);
            sendFileInChunks(peer, file, msg.fileId, id, transferKey);
          }

        } else if (msg.type === 'file:cancel') {
          const transferKey = `${msg.fileId}-${id}`;
          if (activeTransfers.current.has(transferKey)) {
            activeTransfers.current.delete(transferKey);
          }
          if (progressTimers.current[msg.fileId]) {
            clearInterval(progressTimers.current[msg.fileId]);
            delete progressTimers.current[msg.fileId];
          }
          setFiles(prev => prev.map(f => f.id === msg.fileId ? { ...f, status: 'cancelled' } : f));
          setDownloadProgress(prev => { let n = { ...prev }; delete n[msg.fileId]; return n; });
          setUploadProgress(prev => { let n = { ...prev }; delete n[msg.fileId]; return n; });
          delete inboundBuffersRef.current[msg.fileId];

        } else if (msg.type === 'file:complete') {
          const buffer = inboundBuffersRef.current[msg.fileId];
          if (!buffer) return;

          const finishDownload = () => {
            if (buffer.status === 'cancelled') return;

            const blob = new Blob(buffer.chunks);
            const url = URL.createObjectURL(blob);

            // --- DEMO EVIDENCE FOR TEACHER ---
            console.log(`%c [P2P Evidence] 💾 File Blob Created in RAM!`, 'color: #00ff00; font-weight: bold; font-size: 14px;');
            console.log(`🔗 Blob URL: ${url}`);
            console.log(`📦 Size in Memory: ${formatBytes(blob.size)}`);
            // ---------------------------------

            setFiles(prev => prev.map(f => {
              if (f.id === msg.fileId) return { ...f, status: 'completed', url };
              return f;
            }));

            setTimeout(() => {
              setDownloadProgress(prev => { const n = { ...prev }; delete n[msg.fileId]; return n; });
              delete inboundBuffersRef.current[msg.fileId];
            }, 500);

            if (progressTimers.current[msg.fileId]) {
              clearInterval(progressTimers.current[msg.fileId]);
              delete progressTimers.current[msg.fileId];
            }
          };

          const elapsed = Date.now() - buffer.startTime;
          if (elapsed >= 6000) {
            finishDownload();
          } else {
            setTimeout(finishDownload, 6000 - elapsed);
          }
        }
      } catch (err) { console.error("File Msg Error", err); }
    } else {
      // BINARY CHUNK RECEIVE
      const entry = Object.entries(inboundBuffersRef.current).find(([fid, val]) => val.status === 'receiving');
      if (entry) {
        const [fid, val] = entry;
        val.chunks.push(e.data);
        // Cập nhật số byte đã nhận để tính progress thật
        val.receivedBytes += e.data.byteLength;
      }
    }
  };

  const acceptFile = (peerId, fileId, name, size) => {
    const peer = peersRef.current[peerId];
    if (peer) {
      const transferKey = `${fileId}-${peerId}`;
      activeTransfers.current.add(transferKey);

      const startTime = Date.now();
      inboundBuffersRef.current[fileId] = { name, size, chunks: [], startTime, status: 'receiving', receivedBytes: 0 };
      peer.fileChannel.send(JSON.stringify({ type: "file:request", fileId }));
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'receiving' } : f));

      const interval = setInterval(() => {
        if (!activeTransfers.current.has(transferKey)) {
          clearInterval(interval);
          if (inboundBuffersRef.current[fileId]) inboundBuffersRef.current[fileId].status = 'cancelled';
          return;
        }

        const buffer = inboundBuffersRef.current[fileId];
        if (!buffer) return;

        const elapsed = Date.now() - startTime;
        // Logic mới: Progress là MIN của (Time Progress) và (Real Progress)
        // Điều này đảm bảo:
        // 1. File nhỏ: Vẫn chạy animation mượt trong ít nhất 6s (Time limit).
        // 2. File lớn: Không bị kẹt ở 100% mà sẽ chạy theo tốc độ thật (Real limit).
        const timeProgress = (elapsed / 6000) * 100;
        const realProgress = (buffer.receivedBytes / buffer.size) * 100;

        // Chỉ lấy làm tròn khi hiện thị
        const p = Math.min(Math.round(timeProgress), Math.round(realProgress), 100);

        setDownloadProgress(prev => ({ ...prev, [fileId]: p }));

        // KHÔNG còn tự clear interval sau 6s nữa mà đợi msg 'file:complete' clear
      }, 100);
      progressTimers.current[fileId] = interval;
    }
  };

  const sendFileInChunks = async (peer, file, fileId, toPeerId, transferKey) => {
    const reader = file.stream().getReader();
    const startTime = Date.now();
    try {
      while (true) {
        if (!activeTransfers.current.has(transferKey)) {
          reader.cancel();
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        if (peer.fileChannel.readyState !== "open") break;

        // 🟢 FIX: Backpressure handling - Chờ nếu buffer đầy
        while (peer.fileChannel.bufferedAmount > 65536) {
          await new Promise(r => setTimeout(r, 5));
        }

        try { peer.fileChannel.send(value); } catch (err) { break; }

        if (activeTransfers.current.has(transferKey)) {
          const p = Math.min(Math.round(((Date.now() - startTime) / 6000) * 100), 100);
          setUploadProgress(prev => ({ ...prev, [fileId]: p }));
        }

        if (file.size < 1000000) await new Promise(r => setTimeout(r, 60));
      }

      if (activeTransfers.current.has(transferKey)) {
        while (true) {
          if (!activeTransfers.current.has(transferKey)) break;
          const elapsed = Date.now() - startTime;
          if (elapsed >= 6000) break;
          setUploadProgress(prev => ({ ...prev, [fileId]: Math.min(Math.round((elapsed / 6000) * 100), 100) }));
          await new Promise(r => setTimeout(r, 100)); // Sleep
        }
      }

      if (activeTransfers.current.has(transferKey)) {
        setUploadProgress(prev => ({ ...prev, [fileId]: 100 }));
        peer.fileChannel.send(JSON.stringify({ type: 'file:complete', fileId }));

        // CLEANUP Progress Bar for Sender
        setTimeout(() => {
          setUploadProgress(prev => { const n = { ...prev }; delete n[fileId]; return n; });
        }, 500);

        activeTransfers.current.delete(transferKey);
      }
    } catch (err) { console.error(err); }
  };

  const createPeer = useCallback((id, email, stream, initiator = false) => {
    const peer = new PeerService();
    if (stream) stream.getTracks().forEach(track => peer.peer.addTrack(track, stream));

    peer.peer.onicecandidate = (e) => e.candidate && socket.emit("peer:candidate", { candidate: e.candidate, to: id });
    peer.peer.ontrack = (event) => {
      setRemoteStreams(prev => prev.find(p => p.id === id) ? prev : [...prev, { id, email, stream: event.streams[0] }]);
    };

    if (initiator) {
      peer.chatChannel = peer.peer.createDataChannel("chat");
      peer.fileChannel = peer.peer.createDataChannel("file");

      peer.chatChannel.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          setMessages(prev => [...prev, { id: Date.now(), text: d.text, fromEmail: email, fromSelf: false, time: d.time }]);
        } catch (err) { }
      };
      setupFileLogic(peer, email, id);
    } else {
      peer.peer.ondatachannel = (event) => {
        const channel = event.channel;
        if (channel.label === "chat") {
          peer.chatChannel = channel;
          channel.onmessage = (e) => {
            try {
              const d = JSON.parse(e.data);
              setMessages(prev => [...prev, { id: Date.now(), text: d.text, fromEmail: email, fromSelf: false, time: d.time }]);
            } catch (err) { }
          };
        }
        if (channel.label === "file") {
          peer.fileChannel = channel;
          setupFileLogic(peer, email, id);
        }
      };
    }
    return peer;
  }, [socket]);

  useEffect(() => {
    // Xóa logic chặn reload cũ
    const handleBeforeUnload = () => socket.emit("user:leaving", { room: currentRoom });
    window.addEventListener("beforeunload", handleBeforeUnload);

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        setMyStream(stream);
        myStreamRef.current = stream;
      } catch (e) { console.warn("No Camera", e); }
      socket.emit("room:join", { email: myEmail, room: currentRoom });
    };
    init();

    return () => {
      socket.emit("user:leaving", { room: currentRoom });
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (myStreamRef.current) myStreamRef.current.getTracks().forEach(t => t.stop());
      Object.values(peersRef.current).forEach(p => p.peer.close());
    };
  }, []); // Vẫn giữ empty dep

  useEffect(() => {
    const handleJoined = async ({ email, id }) => {
      const p = createPeer(id, email, myStreamRef.current, true);
      peersRef.current[id] = p;
      const offer = await p.getOffer();
      socket.emit("user:call", { to: id, offer });
    };
    const handleInCall = async ({ from, offer, fromEmail }) => {
      const p = createPeer(from, fromEmail, myStreamRef.current, false);
      peersRef.current[from] = p;
      const answer = await p.getAnswer(offer);
      socket.emit("call:accepted", { to: from, ans: answer });
    };
    const handleAccepted = async ({ from, ans }) => peersRef.current[from] && await peersRef.current[from].setLocalDescription(ans);
    const handleCandidate = async ({ candidate, from }) => { if (peersRef.current[from]) await peersRef.current[from].addIceCandidate(candidate); };
    const handleLeft = ({ id, email }) => {
      console.log(`🔻 User Left Event: ID=${id}, Email=${email}`);

      // --- NOTIFICATION ---
      const userEmail = email || "A user";
      toast(`${userEmail} left the room`, {
        icon: '🏃',
        style: { borderRadius: '10px', background: '#333', color: '#fff' },
        duration: 3000
      });
      // --------------------

      setRemoteStreams(prev => prev.filter(s => s.id !== id));
      if (peersRef.current[id]) { peersRef.current[id].peer.close(); delete peersRef.current[id]; }
    };

    socket.on("user:joined", handleJoined);
    socket.on("incoming:call", handleInCall);
    socket.on("call:accepted", handleAccepted);
    socket.on("peer:candidate", handleCandidate);
    socket.on("user:left", handleLeft);
    return () => {
      socket.off("user:joined", handleJoined);
      socket.off("incoming:call", handleInCall);
      socket.off("call:accepted", handleAccepted);
      socket.off("peer:candidate", handleCandidate);
      socket.off("user:left", handleLeft);
    };
  }, [socket, createPeer]);

  const pStream = pinnedId === 'local' ? { stream: myStream, email: "You", id: 'local' } : remoteStreams.find(r => r.id === pinnedId);
  const otherStreams = [{ stream: myStream, email: "You", id: 'local' }, ...remoteStreams].filter(s => s.id !== pinnedId);

  // STYLE CHO HEADER MOBILE
  const headerStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px'
  };

  const leaveBtnStyle = {
    backgroundColor: '#dc3545',
    color: 'white',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '20px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 'bold',
    marginLeft: '10px',
    boxShadow: '0 2px 5px rgba(220, 53, 69, 0.4)'
  };

  return (
    <div className="room-container">
      <header className="room-header" style={{ padding: '10px' }}>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Room: {currentRoom}</h1>
        {/* Responsive Header: Dùng flex-wrap để xuống dòng trên mobile */}
        <div className="connection-status" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', gap: '8px' }}>
          <span>👤 {myEmail}</span>
          <span>|</span>
          <span>👥 {remoteStreams.length + 1}</span>
          <button className="btn-leave" onClick={handleLeaveRoom} style={leaveBtnStyle}>📞 Leave</button>
        </div>
      </header>
      <main className="main-content">
        <div className="video-section">
          <div className="controls-bar">
            <button className={`btn-control ${isScreenSharing ? 'active' : ''}`} onClick={handleScreenShare}>{isScreenSharing ? 'Stop Screen' : 'Screen'}</button>
            <button className={`btn-control ${isRecording ? 'active' : ''}`} onClick={isRecording ? stopRecording : startRecording}>{isRecording ? 'Stop Record' : 'Record'}</button>
            <button className="btn-control" onClick={() => fileInputRef.current?.click()}>📁 File</button>
            <input ref={fileInputRef} type="file" onChange={handleFileSelect} style={{ display: 'none' }} />
            <div className="status-progress-container">
              {Object.entries(uploadProgress).map(([fId, p]) => (
                <ProgressItem key={fId} name={files.find(f => f.id === fId)?.name || 'File'} progress={p} type="upload" status="uploading" onCancel={() => handleCancelFile(fId)} />
              ))}
              {Object.entries(downloadProgress).map(([fId, p]) => (
                <ProgressItem key={fId} name={files.find(f => f.id === fId)?.name || 'File'} progress={p} type="download" status="downloading" onCancel={() => handleCancelFile(fId)} />
              ))}
            </div>
          </div>
          <div className={`video-layout ${pinnedId ? 'spotlight' : 'grid'}`}>
            {pinnedId && pStream && <div className="pinned-video-container"><VideoPlayer stream={pStream.stream} isLocal={pStream.id === 'local'} email={pStream.email} id={pStream.id} onPin={handlePin} isPinned={true} /></div>}
            <div className={`side-videos-grid ${!pinnedId ? 'grid-only' : ''}`}>
              {otherStreams.map(s => <VideoPlayer key={s.id} stream={s.stream} isLocal={s.id === 'local'} email={s.email} id={s.id} onPin={handlePin} isPinned={false} />)}
            </div>
          </div>
        </div>
        <aside className="side-panel">
          <div className="chat-box">
            <div className="panel-header">💬 Chat</div>
            <div className="chat-messages">{messages.map(m => (<div key={m.id} className={`chat-message ${m.fromSelf ? 'self' : 'other'}`}>{!m.fromSelf && <small>{m.fromEmail}</small>}<p>{m.text}</p><div className="message-time">{m.time}</div></div>))}</div>
            <div className="chat-input-wrapper"><input value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} placeholder="Type..." /><button className="btn-send" onClick={handleSendMessage}>Send</button></div>
          </div>
          <div className="file-panel">
            <div className="panel-header">📂 P2P Files</div>
            <div className="file-list">{files.map(f => (
              <div key={f.id} className="file-item">
                <div className="file-info"><span className="file-name" title={f.name}>{f.name}</span> <span style={{ fontSize: '0.8rem', color: '#ccc' }}>({formatBytes(f.size)})</span> <small className={f.status === 'cancelled' ? 'status-cancelled' : ''}>{f.status}</small></div>
                {f.status === 'pending' && <button className="btn-send" onClick={() => acceptFile(f.peerId, f.id, f.name, f.size)}>Accept</button>}
                {f.status === 'completed' && f.url && <a href={f.url} download={f.name} className="dl-btn">💾 Save</a>}
              </div>
            ))}</div>
          </div>
        </aside>
      </main>
    </div>
  );
};

export default Room;