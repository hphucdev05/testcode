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
[Gửi Metadata qua DataChannel]
    |
    v
[Người nhận thấy nút ACCEPT] --(Click)--> [Gửi yêu cầu nhận]
    |                                       |
    v                                       v
[Ghép file & Download] <---(Gửi Chunk)--- [Người gửi đọc File]
