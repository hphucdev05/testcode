class PeerService {
  constructor() {
    this.peer = new RTCPeerConnection({
      iceServers: [
        // Google STUN High Availability
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        // Mozilla STUN
        { urls: "stun:stun.services.mozilla.com" },
        // Twilio STUN (Global)
        { urls: "stun:global.stun.twilio.com:3478" },
        // Free TURN (OpenRelay - Thử nghiệm, có thể chậm nhưng giúp xuyên NAT)
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
          urls: "turn:openrelay.metered.ca:443",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
          urls: "turn:openrelay.metered.ca:443?transport=tcp",
          username: "openrelayproject",
          credential: "openrelayproject"
        }
      ],
      iceCandidatePoolSize: 10,
      iceTransportPolicy: 'all', // Cho phép cả Relay và Host
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    });

    this.chatChannel = null;
    this.fileChannel = null;
    this.iceCandidateQueue = [];
    this.isRemoteSet = false;
  }

  // Create offer
  async getOffer() {
    if (this.peer.signalingState !== "stable") return;
    const offer = await this.peer.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    await this.peer.setLocalDescription(offer);
    return offer;
  }

  // Create answer
  async getAnswer(offer) {
    // Đảm bảo setRemote trước
    if (this.peer.signalingState !== "have-remote-offer") {
      await this.peer.setRemoteDescription(new RTCSessionDescription(offer));
    }
    this.isRemoteSet = true;
    this.processIceQueue();

    const answer = await this.peer.createAnswer();
    await this.peer.setLocalDescription(answer);
    return answer;
  }

  // Set remote description 
  async setLocalDescription(ans) {
    if (this.peer.signalingState === "have-local-offer") {
      await this.peer.setRemoteDescription(new RTCSessionDescription(ans));
      this.isRemoteSet = true;
      this.processIceQueue();
    }
  }

  // Add ICE candidate with buffer safety
  async addIceCandidate(candidate) {
    if (this.isRemoteSet && this.peer.remoteDescription) {
      try {
        await this.peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error("Error adding ICE candidate:", error);
      }
    } else {
      this.iceCandidateQueue.push(candidate);
    }
  }

  processIceQueue() {
    while (this.iceCandidateQueue.length > 0) {
      const candidate = this.iceCandidateQueue.shift();
      this.peer.addIceCandidate(new RTCIceCandidate(candidate))
        .catch(error => console.error("Process buffered ICE Error:", error));
    }
  }
}

export default PeerService;