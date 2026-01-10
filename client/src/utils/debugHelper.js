// Debug Helper for WebRTC Connections
// Add this to your Room.jsx to get detailed connection info

export const debugPeerConnection = (peer, peerId) => {
    if (!peer || !peer.peer) return;

    const pc = peer.peer;

    console.group(`🔍 Debug Info for Peer: ${peerId}`);

    // Connection States
    console.log('Connection State:', pc.connectionState);
    console.log('ICE Connection State:', pc.iceConnectionState);
    console.log('ICE Gathering State:', pc.iceGatheringState);
    console.log('Signaling State:', pc.signalingState);

    // Local Description
    if (pc.localDescription) {
        console.log('Local Description Type:', pc.localDescription.type);
        console.log('Local Description SDP:', pc.localDescription.sdp.substring(0, 100) + '...');
    } else {
        console.warn('❌ No Local Description');
    }

    // Remote Description
    if (pc.remoteDescription) {
        console.log('Remote Description Type:', pc.remoteDescription.type);
        console.log('Remote Description SDP:', pc.remoteDescription.sdp.substring(0, 100) + '...');
    } else {
        console.warn('❌ No Remote Description');
    }

    // Senders (Outgoing Tracks)
    const senders = pc.getSenders();
    console.log(`Senders (${senders.length}):`);
    senders.forEach((sender, i) => {
        if (sender.track) {
            console.log(`  ${i + 1}. ${sender.track.kind} - ${sender.track.label} (${sender.track.readyState})`);
        }
    });

    // Receivers (Incoming Tracks)
    const receivers = pc.getReceivers();
    console.log(`Receivers (${receivers.length}):`);
    receivers.forEach((receiver, i) => {
        if (receiver.track) {
            console.log(`  ${i + 1}. ${receiver.track.kind} - ${receiver.track.label} (${receiver.track.readyState})`);
        }
    });

    // Get Stats
    pc.getStats().then(stats => {
        console.log('📊 Connection Stats:');
        stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                console.log('✅ Active Candidate Pair:', {
                    local: report.localCandidateId,
                    remote: report.remoteCandidateId,
                    bytesReceived: report.bytesReceived,
                    bytesSent: report.bytesSent,
                    currentRoundTripTime: report.currentRoundTripTime
                });
            }

            if (report.type === 'inbound-rtp' && report.kind === 'video') {
                console.log('📹 Inbound Video:', {
                    packetsReceived: report.packetsReceived,
                    packetsLost: report.packetsLost,
                    bytesReceived: report.bytesReceived,
                    framesDecoded: report.framesDecoded
                });
            }

            if (report.type === 'outbound-rtp' && report.kind === 'video') {
                console.log('📹 Outbound Video:', {
                    packetsSent: report.packetsSent,
                    bytesSent: report.bytesSent,
                    framesEncoded: report.framesEncoded
                });
            }
        });
    });

    console.groupEnd();
};

// Usage in Room.jsx:
// Add this to your component:
/*
  useEffect(() => {
    const interval = setInterval(() => {
      Object.keys(peersRef.current).forEach(id => {
        debugPeerConnection(peersRef.current[id], id);
      });
    }, 5000); // Debug every 5 seconds
    
    return () => clearInterval(interval);
  }, []);
*/

// Quick check function
export const quickCheck = (peersRef) => {
    const peers = Object.keys(peersRef.current);
    console.log(`\n🔍 Quick Check - Total Peers: ${peers.length}`);

    peers.forEach(id => {
        const peer = peersRef.current[id];
        if (peer && peer.peer) {
            const state = peer.peer.connectionState;
            const iceState = peer.peer.iceConnectionState;
            const emoji = state === 'connected' ? '✅' : state === 'connecting' ? '🔄' : '❌';
            console.log(`${emoji} Peer ${id}: ${state} (ICE: ${iceState})`);
        }
    });
};

// Check if media is flowing
export const checkMediaFlow = (stream, label = 'Stream') => {
    if (!stream) {
        console.warn(`❌ ${label}: No stream`);
        return;
    }

    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();

    console.group(`🎥 ${label} Media Check`);
    console.log(`Video Tracks: ${videoTracks.length}`);
    videoTracks.forEach((track, i) => {
        console.log(`  ${i + 1}. ${track.label} - ${track.readyState} (enabled: ${track.enabled}, muted: ${track.muted})`);
    });

    console.log(`Audio Tracks: ${audioTracks.length}`);
    audioTracks.forEach((track, i) => {
        console.log(`  ${i + 1}. ${track.label} - ${track.readyState} (enabled: ${track.enabled}, muted: ${track.muted})`);
    });
    console.groupEnd();
};

// Export all
export default {
    debugPeerConnection,
    quickCheck,
    checkMediaFlow
};
