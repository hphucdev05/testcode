import React, { useEffect, useRef, useState, memo, useCallback } from "react";
import { useSocket } from "../context/SocketProvider";
import { useParams, useNavigate } from "react-router-dom";
import PeerService from "../services/Peer";
import '../Room.css';

let reloadHandled = false;

const VideoPlayer = memo(({ stream, isLocal, email, id, onPin, isPinned }) => {
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => { });
    }
  }, [stream]);

  return (
    <div className={`video-wrapper ${isPinned ? 'pinned' : ''} ${!stream ? 'no-stream' : ''}`} onClick={() => onPin(id)}>
      {stream ? (
        <video ref={videoRef} autoPlay playsInline muted={isLocal} style={isLocal ? { transform: "scaleX(-1)" } : {}} />
      ) : (
        <div className="camera-off"><span>📷</span><p>Camera Off</p></div>
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
            type === 'upload' ? '📤 Sending...' : `📥 Receiving ${name}...`}
      </small>
      {status !== 'cancelled' && status !== 'completed' && (
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
  const { roomId } = useParams();
  const myEmail = localStorage.getItem('userEmail') || 'Anonymous';
  const currentRoom = roomId || '1';

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
  const progressTimers = useRef({}); // Quản lý Timer để hủy ngay lập tức

  const handlePin = (id) => setPinnedId(prev => (prev === id ? null : id));

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
        videoTrack.onended = () => stopScreenShare();
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

  // --- CHAT ---
  const handleSendMessage = () => {
    if (!message.trim()) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const payload = JSON.stringify({ text: message, time });

    Object.values(peersRef.current).forEach(p => {
      if (p.chatChannel && p.chatChannel.readyState === "open") p.chatChannel.send(payload);
    });

    // Cập nhật ngay lập tức UI local
    setMessages(prev => [...prev, { id: Date.now(), text: message, fromEmail: myEmail, fromSelf: true, time }]);
    setMessage("");
  };

  // --- FILE TRANSFER ---
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fileId = `file-${Date.now()}`;
    outboundFilesRef.current[fileId] = file;
    Object.values(peersRef.current).forEach(p => {
      if (p.fileChannel && p.fileChannel.readyState === "open") {
        p.fileChannel.send(JSON.stringify({ type: "file:offer", fileId, name: file.name, size: file.size }));
      }
    });
    setFiles(prev => [...prev, { id: fileId, name: file.name, size: file.size, status: 'offered', type: 'sent' }]);
    e.target.value = '';
  };

  // Hàm Hủy File chuẩn: Dừng Timer, Dừng Gửi, Báo Bên Kia, Giữ UI "Cancelled"
  const handleCancelFile = (fileId) => {
    // 1. Dừng ngay Timer Progress (Fix lỗi bên nhận vẫn chạy 100%)
    if (progressTimers.current[fileId]) {
      clearInterval(progressTimers.current[fileId]);
      delete progressTimers.current[fileId];
    }

    // 2. Ngắt luồng gửi/nhận
    activeTransfers.current.delete(fileId);

    // 3. Gửi tín hiệu Cancel cho đối tác
    const file = files.find(f => f.id === fileId);
    if (file) {
      // Gửi cho tất cả peer (đơn giản hóa)
      Object.values(peersRef.current).forEach(p => {
        if (p.fileChannel && p.fileChannel.readyState === "open") {
          try { p.fileChannel.send(JSON.stringify({ type: "file:cancel", fileId })); } catch (e) { }
        }
      });
    }

    // 4. Update UI: KHÔNG XÓA, chỉ đổi status thành Cancelled
    setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'cancelled' } : f));

    // 5. Dọn dẹp Progress Bar UI (để lại 1 lúc rồi xóa hoặc xóa luôn tùy ý - ở đây ta xóa bar nhưng giữ file trong list)
    setUploadProgress(prev => { let n = { ...prev }; delete n[fileId]; return n; });
    setDownloadProgress(prev => { let n = { ...prev }; delete n[fileId]; return n; });

    // 6. Xóa buffer
    delete inboundBuffersRef.current[fileId];
  };

  const setupFileLogic = (peer, email, id) => {
    peer.fileChannel.onmessage = async (e) => {
      if (typeof e.data === 'string') {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'file:offer') {
            setFiles(prev => [...prev, { id: msg.fileId, peerId: id, name: msg.name, size: msg.size, status: 'pending', from: email }]);
          } else if (msg.type === 'file:request') {
            const file = outboundFilesRef.current[msg.fileId];
            if (file) { activeTransfers.current.add(msg.fileId); sendFileInChunks(peer, file, msg.fileId); }
          } else if (msg.type === 'file:cancel') {
            // Nhận tín hiệu hủy từ bên kia
            if (progressTimers.current[msg.fileId]) {
              clearInterval(progressTimers.current[msg.fileId]);
              delete progressTimers.current[msg.fileId];
            }
            activeTransfers.current.delete(msg.fileId);
            setFiles(prev => prev.map(f => f.id === msg.fileId ? { ...f, status: 'cancelled' } : f));
            setDownloadProgress(prev => { let n = { ...prev }; delete n[msg.fileId]; return n; });
            setUploadProgress(prev => { let n = { ...prev }; delete n[msg.fileId]; return n; });
            delete inboundBuffersRef.current[msg.fileId];
          } else if (msg.type === 'file:complete') {
            const buffer = inboundBuffersRef.current[msg.fileId];
            if (buffer) {
              const checkDone = setInterval(() => {
                const elapsed = Date.now() - buffer.startTime;
                // Lưu timer này để có thể cancel
                if (!progressTimers.current[msg.fileId]) progressTimers.current[msg.fileId] = checkDone;

                const p = Math.min(Math.round((elapsed / 6000) * 100), 100);
                setDownloadProgress(prev => ({ ...prev, [msg.fileId]: p }));
                if (elapsed >= 6000) {
                  clearInterval(checkDone);
                  delete progressTimers.current[msg.fileId];
                  const blob = new Blob(buffer.chunks);
                  const url = URL.createObjectURL(blob);
                  setFiles(prev => prev.map(f => f.id === msg.fileId ? { ...f, status: 'completed', url } : f));
                  setTimeout(() => {
                    setDownloadProgress(prev => { let n = { ...prev }; delete n[msg.fileId]; return n; });
                    delete inboundBuffersRef.current[msg.fileId];
                  }, 500);
                }
              }, 100);
            }
          }
        } catch (err) { console.error("File Msg Error", err); }
      } else {
        const activeId = Object.keys(inboundBuffersRef.current)[0];
        if (activeId) { inboundBuffersRef.current[activeId].chunks.push(e.data); }
      }
    };
  };

  const acceptFile = (peerId, fileId, name, size) => {
    const peer = peersRef.current[peerId];
    if (peer) {
      const startTime = Date.now();
      inboundBuffersRef.current[fileId] = { name, size, chunks: [], startTime };
      peer.fileChannel.send(JSON.stringify({ type: "file:request", fileId }));
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'receiving' } : f));

      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const p = Math.min(Math.round((elapsed / 6000) * 100), 100);
        setDownloadProgress(prev => ({ ...prev, [fileId]: p }));
        if (elapsed >= 6000 || !inboundBuffersRef.current[fileId]) {
          clearInterval(interval);
          if (progressTimers.current[fileId] === interval) delete progressTimers.current[fileId];
        }
      }, 100);
      progressTimers.current[fileId] = interval; // Lưu timer để hủy
    }
  };

  const sendFileInChunks = async (peer, file, fileId) => {
    const reader = file.stream().getReader();
    const startTime = Date.now();
    try {
      while (true) {
        if (!activeTransfers.current.has(fileId)) break;
        const { done, value } = await reader.read();
        if (done) break;
        peer.fileChannel.send(value);
        const p = Math.min(Math.round(((Date.now() - startTime) / 6000) * 100), 100);
        setUploadProgress(prev => ({ ...prev, [fileId]: p }));
        if (file.size < 1000000) await new Promise(r => setTimeout(r, 60));
      }

      // Fake progress finish loop (nếu gửi xong sớm)
      if (activeTransfers.current.has(fileId)) {
        // Tạo loop để chạy nốt time còn lại cho đủ 6s
        // Tuy nhiên, vì logic gửi file chạy async nên khó clear interval từ ngoài.
        // Ta check activeTransfers ở mỗi vòng lặp là đủ an toàn.
        while (activeTransfers.current.has(fileId)) {
          const elapsed = Date.now() - startTime;
          if (elapsed >= 6000) break;
          setUploadProgress(prev => ({ ...prev, [fileId]: Math.min(Math.round((elapsed / 6000) * 100), 100) }));
          await new Promise(r => setTimeout(r, 100)); // Sleep
        }
      }

      if (activeTransfers.current.has(fileId)) {
        setUploadProgress(prev => ({ ...prev, [fileId]: 100 }));
        peer.fileChannel.send(JSON.stringify({ type: 'file:complete', fileId }));
        setTimeout(() => setUploadProgress(prev => { let n = { ...prev }; delete n[fileId]; return n; }), 500);
      }
    } catch (err) { console.error(err); }
  };

  const createPeer = useCallback((id, email, stream) => {
    const peer = new PeerService();
    if (stream) stream.getTracks().forEach(track => peer.peer.addTrack(track, stream));
    peer.peer.ontrack = (event) => setRemoteStreams(prev => prev.find(p => p.id === id) ? prev : [...prev, { id, email, stream: event.streams[0] }]);
    peer.peer.onicecandidate = (e) => e.candidate && socket.emit("peer:candidate", { candidate: e.candidate, to: id });
    peer.peer.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label === "chat") {
        peer.chatChannel = channel;
        channel.onmessage = (e) => {
          try {
            const d = JSON.parse(e.data);
            setMessages(prev => [...prev, { id: Date.now(), text: d.text, fromEmail: email, fromSelf: false, time: d.time }]);
          } catch (err) {
            setMessages(prev => [...prev, { id: Date.now(), text: e.data, fromEmail: email, fromSelf: false, time: "Now" }]);
          }
        };
      }
      if (channel.label === "file") { peer.fileChannel = channel; setupFileLogic(peer, email, id); }
    };
    return peer;
  }, [socket]);

  useEffect(() => {
    const isReload = window.performance && window.performance.getEntriesByType("navigation")[0]?.type === "reload";
    if (isReload && !reloadHandled) { reloadHandled = true; navigate("/"); return; }

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
  }, []);

  useEffect(() => {
    const handleJoined = async ({ email, id }) => {
      const p = createPeer(id, email, myStreamRef.current);
      p.chatChannel = p.peer.createDataChannel("chat");
      p.fileChannel = p.peer.createDataChannel("file");
      setupFileLogic(p, email, id);
      peersRef.current[id] = p;
      const offer = await p.getOffer();
      socket.emit("user:call", { to: id, offer });
    };
    const handleInCall = async ({ from, offer, fromEmail }) => {
      const p = createPeer(from, fromEmail, myStreamRef.current);
      peersRef.current[from] = p;
      const answer = await p.getAnswer(offer);
      socket.emit("call:accepted", { to: from, ans: answer });
    };
    const handleAccepted = async ({ from, ans }) => peersRef.current[from] && await peersRef.current[from].setLocalDescription(ans);
    const handleCandidate = async ({ candidate, from }) => peersRef.current[from] && await peersRef.current[from].addIceCandidate(candidate);
    const handleLeft = ({ id }) => {
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

  return (
    <div className="room-container">
      <header className="room-header">
        <h1>Room: {currentRoom}</h1>
        <div className="connection-status">👤 {myEmail} | 👥 {remoteStreams.length + 1} users</div>
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
                <div className="file-info"><span className="file-name">{f.name}</span><small className={f.status === 'cancelled' ? 'status-cancelled' : ''}>{f.status}</small></div>
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