# GIẢI THUẬT MÃ GIẢ (PSEUDO CODE)

## 1. Quy trình thiết lập cuộc gọi (Signaling Process)
```text
FUNCTION On_User_Join(target_email, target_id):
    - Khởi tạo PeerConnection (PC)
    - Gắn luồng Media (Camera/Mic) vào PC
    - Tạo OFFER (SDP)
    - Lưu LocalDescription
    - Gửi OFFER qua Socket.io tới target_id
END FUNCTION

FUNCTION On_Receive_Offer(sender_id, offer):
    - Khởi tạo PeerConnection (PC)
    - Gắn luồng Media (Camera/Mic) vào PC
    - Lưu RemoteDescription (từ offer)
    - Tạo ANSWER (SDP)
    - Lưu LocalDescription
    - Gửi ANSWER qua Socket.io tới sender_id
END FUNCTION

FUNCTION On_ICE_Candidate(candidate, target_id):
    - Gửi thông tin mạng (Candidate) tới đối phương qua Signaling Server
END FUNCTION
```

## 2. Quy trình truyền File P2P (File Handshake)
```text
SENDER:
    - INPUT: User chọn file
    - EXTRACT: metadata = {name, size, fileID}
    - SEND: "file:offer" (metadata) qua DataChannel
    - WAIT: tín hiệu "file:request" từ Receiver

RECEIVER:
    - ON: Nhận "file:offer"
    - UI: Hiển thị bảng điều khiển kèm nút [ACCEPT]
    - IF [ACCEPT] CLICKED:
        - INIT: buffer = [] (Mảng chứa các mảnh file)
        - SEND: "file:request" (fileID)
    - ON binary data: Nhận từng mảnh (chunk) -> push vào buffer

SENDING_PROCESS (SENDER):
    - CHUNK: Chia file thành từng phần 16KB
    - LOOP: Gửi từng mảnh qua DataChannel
    - EMIT: Cập nhật Progress Bar (phần trăm đã gửi)
    - FINISH: Gửi "file:complete"
```
