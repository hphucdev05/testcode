class PeerService {
  constructor() {
    this.peer = new RTCPeerConnection({
      iceServers: [
        {
          urls: [
            "stun:stun.l.google.com:19302",
            "stun:stun1.l.google.com:19302",
            "stun:stun2.l.google.com:19302",
            "stun:global.stun.twilio.com:3478",
          ],
        },
      ],
      iceCandidatePoolSize: 10,
    });

    this.chatChannel = null;
    this.fileChannel = null;
    this.iceCandidateQueue = [];
    this.isRemoteSet = false;
  }

  // Create offer
  async getOffer() {
    const offer = await this.peer.createOffer();
    await this.peer.setLocalDescription(offer);
    return offer;
  }

  // Create answer
  async getAnswer(offer) {
    await this.peer.setRemoteDescription(new RTCSessionDescription(offer));
    this.isRemoteSet = true;
    this.processIceQueue();

    const answer = await this.peer.createAnswer();
    await this.peer.setLocalDescription(answer);
    return answer;
  }

  // Set remote description (after receiving answer)
  async setLocalDescription(answer) {
    await this.peer.setRemoteDescription(new RTCSessionDescription(answer));
    this.isRemoteSet = true;
    this.processIceQueue();
  }

  // Add ICE candidate
  async addIceCandidate(candidate) {
    if (this.isRemoteSet && this.peer.remoteDescription) {
      try {
        await this.peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error("Error adding ICE candidate:", error);
      }
    } else {
      console.log("Buffering ICE candidate");
      this.iceCandidateQueue.push(candidate);
    }
  }

  // Process buffered ICE candidates
  processIceQueue() {
    while (this.iceCandidateQueue.length > 0) {
      const candidate = this.iceCandidateQueue.shift();
      this.peer.addIceCandidate(new RTCIceCandidate(candidate))
        .catch(error => console.error("Error processing buffered ICE:", error));
    }
  }

  // Send file with progress tracking
  // Demonstrates: TCP-like reliable transfer, Flow control, Chunking
  async sendFile(file, onProgress = null) {
    if (!this.fileChannel) {
      console.error("📁 File channel not available");
      throw new Error("File channel not initialized");
    }

    // Wait for channel to open
    if (this.fileChannel.readyState !== "open") {
      console.log("📁 Waiting for file channel to open...");
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Channel open timeout")), 10000);
        this.fileChannel.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };
      });
    }

    const CHUNK_SIZE = 16384; // 16KB - optimal for WebRTC Data Channel
    let offset = 0;
    const totalSize = file.size;

    console.log(`📁 Starting file transfer: ${file.name} (${(totalSize / 1024 / 1024).toFixed(2)} MB)`);

    // Send metadata first (JSON message)
    this.fileChannel.send(JSON.stringify({
      type: "file:metadata",
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream'
    }));

    // Send file in chunks (Binary data)
    return new Promise((resolve, reject) => {
      const sendChunk = () => {
        if (offset >= totalSize) {
          // Send completion signal
          this.fileChannel.send(JSON.stringify({
            type: "file:complete",
            name: file.name
          }));
          console.log(`✅ File transfer complete: ${file.name}`);
          if (onProgress) onProgress(100);
          resolve();
          return;
        }

        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const reader = new FileReader();

        reader.onload = (e) => {
          try {
            this.fileChannel.send(e.target.result);
            offset += e.target.result.byteLength;

            // Calculate and report progress
            const progress = Math.round((offset / totalSize) * 100);
            if (onProgress) onProgress(progress);

            // Flow control: Check buffer before sending next chunk
            if (this.fileChannel.bufferedAmount > 1000000) { // 1MB buffer threshold
              this.fileChannel.onbufferedamountlow = () => {
                this.fileChannel.onbufferedamountlow = null;
                sendChunk();
              };
            } else {
              // Continue immediately if buffer is not full
              sendChunk();
            }
          } catch (error) {
            console.error("❌ Error sending chunk:", error);
            reject(error);
          }
        };

        reader.onerror = (error) => {
          console.error("❌ Error reading file:", error);
          reject(error);
        };

        reader.readAsArrayBuffer(slice);
      };

      sendChunk();
    });
  }
}

export default PeerService;