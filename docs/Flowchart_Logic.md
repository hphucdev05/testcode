# HƯỚNG DẪN VẼ FLOWCHART (SƠ ĐỒ LUỒNG)

Dựa vào các bước này để vẽ trên Draw.io hoặc Lucidchart:

## 1. Luồng chính của Ứng dụng (App Flow)
[Bắt đầu]
    |
    v
[Trang Lobby] --(Nhập Email/Phòng)--> [Nhấn Join]
    |
    v
[Yêu cầu quyền Truy cập Camera/Mic]
    |
    +----[Từ chối]----> [Hiển thị lỗi - Dừng]
    |
    +----[Chấp nhận]--> [Connect Socket Server]
    |
    v
[Tham gia Phòng (Room)]
    |
    +----[Nếu phòng đã có người]----> [Thực hiện bắt tay WebRTC (Signaling)]
    |                                   |
    |                                   v
    |                             [Thiết lập kết nối P2P] ----> [Hiện Video đối phương]
    |
    +----[Nếu phòng trống]----------> [Chờ người khác tham gia]
    |
    v
[Các tính năng khả dụng]
    +--> [Trò chuyện Chat] --> [Gửi JSON qua DataChannel]
    +--> [Ghim Video (Pin)] --> [Thay đổi Layout UI]
    +--> [Chia sẻ màn hình] --> [Thay đổi MediaTrack]
    +--> [Ghi hình] ----------> [Ghi luồng MediaStream]
    +--> [Truyền tệp P2P] ----> [Handshake & Chunking]

## 2. Luồng truyền File (File Transfer Flow)
                       [Người gửi chọn tệp]
                               |
                               v
               [Gửi Metadata (Offer) qua DataChannel]
                               |
                               v
[Người nhận thấy nút ACCEPT] --(Click)--> [Gửi yêu cầu nhận (Request)]
                                          |
                                          v
                    +---------------------------------------+
                    |        BẮT ĐẦU TRUYỀN DỮ LIỆU         |
                    +---------------------------------------+
                    |                                       |
    [Người gửi đọc File Chunk] --------(Gửi Chunk)-------> [Người nhận tích lũy Buffer]
                    |                                       |
                    |            <--[Nút X]-->              | (Bất kỳ lúc nào)
          +---------+---------+                             |
          |                   |                             |
  [Người gửi bấm Hủy]   [Người nhận bấm Hủy]                |
          |                   |                             |
          v                   v                             v
[Dừng vòng lặp gửi]    [Dừng Timer & Buffer]   [Nếu chạy hết 100%]
          |                   |                             |
          v                   v                             v
[Gửi tín hiệu Cancel]  [Gửi tín hiệu Cancel]      [Gửi tín hiệu Complete]
  (Broadcast All)      (Unicast to Sender)                  |
          |                   |                             |
          v                   v                             v
[Đối phương nhận Cancel] [Sender dừng gửi cho Peer] [Người nhận ghép File Blob]
          |                   |                             |
          v                   v                             v
[Cập nhật UI: Cancelled] [Cập nhật UI: Cancelled] [Hiện nút Save & Xóa Progress]

## 3. Chi tiết logic Hủy (Cancellation Logic)
*   **Sender Cancel:** Dừng gửi cho *tất cả* người nhận trong phòng -> Gửi Broadcast Cancel.
*   **Receiver Cancel:** Chỉ dừng nhận file của *riêng mình* -> Gửi Unicast Cancel cho Sender.
*   **Cleanup:**
    1.  Xóa cờ `ActiveTransfer`.
    2.  Xóa bộ đếm `Progress Timer`.
    3.  Giải phóng bộ nhớ Buffer.
    4.  Cập nhật trạng thái UI thành `Cancelled` (giữ trong list) hoặc Xóa khỏi list (đối với người nhận đã hủy).
