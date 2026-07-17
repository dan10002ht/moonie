# 04 — Data Dictionary — Website Mooni Cake

> **Cập nhật:** 2026-07-17 · **Commit nguồn:** `51d60a1`
> Tài liệu phái sinh — nguồn chân lý là spec/code; nếu lệch nhau, spec/code thắng.
> ⚠️ **Sinh từ mục Database (spec §3) — `api/migrations/` CHƯA tồn tại. Sẽ đối chiếu lại với migrations thật khi code.** Kiểu dữ liệu cụ thể (varchar/numeric/timestamp, khóa, index, đơn vị tiền) chưa được spec định nghĩa nên KHÔNG ghi ở đây — chỉ ghi thuộc tính nghiệp vụ và ràng buộc mà spec nêu.

DB: PostgreSQL 16. 6 bảng. Truy vấn chỉ qua sqlc; migration chỉ thêm file mới (CLAUDE.md).

## 1. `products` — sản phẩm

| Thuộc tính | Ràng buộc/giá trị | Ý nghĩa nghiệp vụ |
|---|---|---|
| slug | — | Định danh thân thiện URL |
| tên | — | Tên hiển thị (vd. Nguyệt Quang Kim) |
| mô tả | — | Mô tả sản phẩm trên landing |
| giá | số dương (spec §6) | Giá bán hiện hành; đơn cũ không bị ảnh hưởng khi đổi (snapshot ở `order_items`) |
| loại | `gift_box` \| `single_cake` | Hộp quà hay bánh lẻ |
| trạng thái | `available` \| `sold_out` \| `hidden` | `hidden` không xuất hiện trên API public; đây là cơ chế "tồn kho" duy nhất spec định nghĩa (⚠️ SRS mâu thuẫn #2) |
| ảnh | file trong `uploads/` trên VPS | Upload qua admin, Go API serve tĩnh |
| thứ tự hiển thị | — | Sắp xếp trên landing |

## 2. `leads` — khách để lại thông tin

| Thuộc tính | Ràng buộc/giá trị | Ý nghĩa nghiệp vụ |
|---|---|---|
| tên | — | Tên khách |
| SĐT | validate định dạng tại API boundary | Kênh liên hệ chính; log chỉ 4 số cuối (NFR-009) |
| lời nhắn | — | Nội dung khách nhập ở form |
| sản phẩm quan tâm | — | Sản phẩm khách chọn/quan tâm khi điền form |
| nguồn | — | Nguồn lead |
| trạng thái | `new` → `contacted` → `converted` \| `closed` | Vòng đời xử lý lead |
| FK order | có giá trị khi `converted` | Liên kết đơn được tạo từ lead |

## 3. `customers` — khách hàng

| Thuộc tính | Ràng buộc/giá trị | Ý nghĩa nghiệp vụ |
|---|---|---|
| tên | — | |
| SĐT | validate định dạng | |
| email | validate định dạng | |
| công ty | — | Dành cho khách doanh nghiệp |
| địa chỉ | — | |
| loại | `personal` \| `business` | Phân nhóm cá nhân / doanh nghiệp |
| ghi chú | — | Ghi chú nội bộ của admin |

## 4. `orders` — đơn hàng

| Thuộc tính | Ràng buộc/giá trị | Ý nghĩa nghiệp vụ |
|---|---|---|
| mã đơn | — | Mã tham chiếu đơn |
| FK customer | tham chiếu `customers` | Khách của đơn |
| trạng thái | `new` → `confirmed` → `delivering` → `done` \| `cancelled` | Vòng đời đơn |
| kênh | `website` \| `phone` \| `zalo` \| `fb` | Nguồn đơn |
| tổng tiền | số dương | |
| giảm giá | số dương | |
| ngày giao | — | |
| địa chỉ giao | — | |
| ghi chú | — | |

Ràng buộc nghiệp vụ: order tạo cùng `order_items` trong 1 transaction (spec §3).

## 5. `order_items` — dòng hàng của đơn

| Thuộc tính | Ràng buộc/giá trị | Ý nghĩa nghiệp vụ |
|---|---|---|
| FK order | tham chiếu `orders` | |
| FK product | tham chiếu `products` | |
| tên (snapshot) | chụp tại thời điểm đặt | Bất biến sau khi tạo — đổi tên sản phẩm không ảnh hưởng đơn cũ |
| đơn giá (snapshot) | chụp tại thời điểm đặt; số dương | Bất biến sau khi tạo — đổi giá sản phẩm không ảnh hưởng đơn cũ |
| số lượng | số dương | |

## 6. `admin_users` — tài khoản quản trị

| Thuộc tính | Ràng buộc/giá trị | Ý nghĩa nghiệp vụ |
|---|---|---|
| email | validate định dạng | Định danh đăng nhập |
| password hash | bcrypt | Không lưu plaintext |
| tên | — | |
| role | — | Spec chưa liệt kê các giá trị role (⚠️ chốt khi làm migrations) |

Ràng buộc nghiệp vụ: không có đăng ký public — bản ghi tạo bằng CLI seed (spec §6).
