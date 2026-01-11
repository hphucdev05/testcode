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

const ProgressItem = ({ id, name, progress, type, onCancel }) => (
  <div className={`progress-item ${type}`}>
    <div className="progress-header">
      <small>{type === 'upload' ? '📤 Sending...' : `📥 Receiving ${name}...`}</small>
      <button className="btn-close-mini" onClick={onCancel}>×</button>
    </div>
    <div className="progress-item-inner">
      <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }}></div></div>
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
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [pinnedId, setPinnedId] = useState('local');
  const [files, setFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState({});
  const [downloadProgress, setDownloadProgress] = useState({});

  const peersRef = useRef({});
  const initialized = useRef(false);
  const fileInputRef = useRef(null);
  const outboundFilesRef = useRef({});
  const inboundBuffersRef = useRef({});
  const activeTransfers = useRef(new Set());

  const handlePin = (id) => setPinnedId(prev => (prev === id ? null : id));

  const handleSendMessage = () => {
    if (!message.trim()) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const payload = JSON.stringify({ text: message, time });
    Object.values(peersRef.current).forEach(p => p.chatChannel?.readyState === "open" && p.chatChannel.send(payload));
    setMessages(prev => [...prev, { id: Date.now(), text: message, fromEmail: myEmail, fromSelf: true, time }]);
    setMessage("");
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fileId = `file-${Date.now()}`;
    outboundFilesRef.current[fileId] = file;
    Object.values(peersRef.current).forEach(p => {
      p.fileChannel?.readyState === "open" && p.fileChannel.send(JSON.stringify({ type: "file:offer", fileId, name: file.name, size: file.size }));
    });
    setFiles(prev => [...prev, { id: fileId, name: file.name, size: file.size, status: 'offered', type: 'sent' }]);
    e.target.value = '';
  };

  const setupFileLogic = (peer, email, id) => {
    peer.fileChannel.onmessage = async (e) => {
      if (typeof e.data === 'string') {
        const msg = JSON.parse(e.data);
        if (msg.type === 'file:offer') {
          setFiles(prev => [...prev, { id: msg.fileId, peerId: id, name: msg.name, size: msg.size, status: 'pending', from: email }]);
        } else if (msg.type === 'file:request') {
          const file = outboundFilesRef.current[msg.fileId];
          if (file) { activeTransfers.current.add(msg.fileId); sendFileInChunks(peer, file, msg.fileId); }
        } else if (msg.type === 'file:complete') {
          const buffer = inboundBuffersRef.current[msg.fileId];
          if (buffer) {
            const checkDone = setInterval(() => {
              const elapsed = Date.now() - buffer.startTime;
              const p = Math.min(Math.round((elapsed / 6000) * 100), 100);
              setDownloadProgress(prev => ({ ...prev, [msg.fileId]: p }));
              if (elapsed >= 6000) {
                clearInterval(checkDone);
                const blob = new Blob(buffer.chunks);
                const url = URL.createObjectURL(blob);
                setFiles(prev => prev.map(f => f.id === msg.fileId ? { ...f, status: 'completed', url } : f));
                setTimeout(() => {
                  setDownloadProgress(prev => { let n = { ...prev }; delete n[msg.fileId]; return n; });
                  delete inboundBuffersRef.current[msg.fileId];
                }, 1000);
              }
            }, 100);
          }
        }
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
        if (elapsed >= 6000 || !inboundBuffersRef.current[fileId]) clearInterval(interval);
      }, 100);
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
      while (activeTransfers.current.has(fileId)) {
        const elapsed = Date.now() - startTime;
        if (elapsed >= 6000) break;
        setUploadProgress(prev => ({ ...prev, [fileId]: Math.min(Math.round((elapsed / 6000) * 100), 100) }));
        await new Promise(r => setTimeout(r, 100));
      }
      if (activeTransfers.current.has(fileId)) {
        setUploadProgress(prev => ({ ...prev, [fileId]: 100 }));
        peer.fileChannel.send(JSON.stringify({ type: 'file:complete', fileId }));
        setTimeout(() => setUploadProgress(prev => { let n = { ...prev }; delete n[fileId]; return n; }), 1000);
      }
    } catch (err) { console.error(err); }
  };

  const createPeer = useCallback((id, email, stream) => {
    const peer = new PeerService();
    if (stream) stream.getTracks().forEach(track => peer.peer.addTrack(track, stream));
    peer.peer.ontrack = (event) => {
      setRemoteStreams(prev => {
        if (prev.find(p => p.id === id)) return prev;
        return [...prev, { id, email, stream: event.streams[0] }];
      });
    };
    peer.peer.onicecandidate = (e) => e.candidate && socket.emit("peer:candidate", { candidate: e.candidate, to: id });
    peer.peer.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label === "chat") {
        peer.chatChannel = channel;
        channel.onmessage = (e) => {
          const d = JSON.parse(e.data);
          setMessages(prev => [...prev, { id: Date.now(), text: d.text, fromEmail: email, fromSelf: false, time: d.time }]);
        };
      }
      if (channel.label === "file") { peer.fileChannel = channel; setupFileLogic(peer, email, id); }
    };
    return peer;
  }, [socket]);

  // EFFECT 1: QUẢN LÝ KẾT NỐI VÀ DỌN DẸP TUYỆT ĐỐI (Dùng [] để chỉ chạy 1 lần)
  useEffect(() => {
    const isReload = window.performance && window.performance.getEntriesByType("navigation")[0]?.type === "reload";
    if (isReload && !reloadHandled) { reloadHandled = true; navigate("/"); return; }

    const handleBeforeUnload = () => {
      socket.emit("user:leaving", { room: currentRoom });
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    if (!initialized.current) {
      initialized.current = true;
      (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
          setMyStream(stream);
          socket.emit("room:join", { email: myEmail, room: currentRoom });
        } catch (e) {
          socket.emit("room:join", { email: myEmail, room: currentRoom });
        }
      })();
    }

    return () => {
      console.log("Cleanup unmounting...");
      socket.emit("user:leaving", { room: currentRoom });
      window.removeEventListener("beforeunload", handleBeforeUnload);
      Object.values(peersRef.current).forEach(p => p.peer.close());
    };
  }, []);

  // EFFECT 2: XỬ LÝ SOCKET EVENTS KHI STREAM ĐÃ SẴN SÀNG
  useEffect(() => {
    const handleJoined = async ({ email, id }) => {
      const p = createPeer(id, email, myStream);
      p.chatChannel = p.peer.createDataChannel("chat");
      p.fileChannel = p.peer.createDataChannel("file");
      setupFileLogic(p, email, id);
      peersRef.current[id] = p;
      const offer = await p.getOffer();
      socket.emit("user:call", { to: id, offer });
    };
    const handleInCall = async ({ from, offer, fromEmail }) => {
      const p = createPeer(from, fromEmail, myStream);
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
            <button className="btn-control" onClick={() => fileInputRef.current?.click()}>📁 File</button>
            <input ref={fileInputRef} type="file" onChange={handleFileSelect} style={{ display: 'none' }} />
            <div className="status-progress-container">
              {Object.entries(uploadProgress).map(([fId, p]) => (
                <ProgressItem key={fId} name={files.find(f => f.id === fId)?.name} progress={p} type="upload" onCancel={() => { }} />
              ))}
              {Object.entries(downloadProgress).map(([fId, p]) => (
                <ProgressItem key={fId} name={files.find(f => f.id === fId)?.name} progress={p} type="download" onCancel={() => { }} />
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
            <div className="chat-messages">{messages.map(m => (<div key={m.id} className={`chat-message ${m.fromSelf ? 'self' : 'other'}`}>{!m.fromSelf && <small>{m.fromEmail}</small>}<p>{m.text}</p></div>))}</div>
            <div className="chat-input-wrapper"><input value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} /><button onClick={handleSendMessage}>Send</button></div>
          </div>
          <div className="file-panel">
            <div className="panel-header">📂 P2P Files</div>
            <div className="file-list">{files.map(f => (
              <div key={f.id} className="file-item">
                <div className="file-info"><span>{f.name}</span><small>{f.status}</small></div>
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