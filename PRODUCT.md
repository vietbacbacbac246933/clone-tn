# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Học sinh — người ôn tập.** Dùng **điện thoại của chính mình** để làm lại đề: mở `/on-tap` chọn đề giáo viên đã công khai, hoặc mở file HTML offline giáo viên gửi. Việc các em cần làm: chọn đề, làm bài, nộp bài và xem điểm/đáp án. Không còn phòng thi trực tiếp, không cần chọn tên hay mã PIN.

**Giáo viên — người ra đề và quản lý dữ liệu.** Việc cần làm: quản lý lớp và danh sách học sinh, nhập đề từ file Word đã soạn sẵn, sửa và xác nhận đề trước khi lưu, quản lý bài kiểm tra, công khai đề cho ôn tập, xuất file offline, xem kết quả thi cũ và xuất Excel.

Chưa có bằng chứng về vai thứ ba (phụ huynh, quản trị viên nhà trường, học sinh tự đăng ký tài khoản).

## Product Purpose

Biến đề kiểm tra mà giáo viên **đã có sẵn trên giấy hoặc trong file Word** thành bài luyện tập/kiểm tra số hoá, mà không phải gõ lại từng câu. Sản phẩm tồn tại để một giáo viên có thể nhập đề nhanh, quản lý ngân hàng câu hỏi và giao bài cho học sinh qua web hoặc file offline, với chi phí hạ tầng gần như bằng không.

Thành công nghĩa là: giáo viên nhập được đề thật (kể cả đề in 2 cột, có công thức, có ảnh) mà không phải sửa tay quá nhiều; và học sinh mở được bài ôn tập trong vài giây, không cần tài khoản.

## Positioning

Cơ chế riêng: **đọc đề từ Word và tự nhận ra đáp án đúng** — dấu `*`, `[x]`, `(đúng)`, hoặc **gạch chân dưới đáp án** trong `.docx` (chỉ xét trong dòng đáp án). Kết quả luôn đi qua **bản xem trước sửa được** và chỉ ghi dữ liệu khi giáo viên bấm xác nhận; câu thiếu căn cứ bị gắn nhãn *cần kiểm tra* và **bị bỏ qua khi lưu** chứ không tự gán đáp án A.

Sản phẩm chạy trên **hạ tầng tự host/serverless, không thu phí theo đầu học sinh** như Quizizz/Azota. Lợi thế cạnh tranh không nằm ở giao diện thi, mà ở **chi phí nhập đề bằng 0 cho giáo viên** và khả năng xuất **file HTML offline** để học sinh tự làm mà không cần server.

## Operating Context

- **Hạ tầng: Internet, không phải LAN.** Server chạy trên Vercel (serverless); tên gọi cũ "LAN" là di sản của bản gốc chạy trong mạng nội bộ.
- **Serverless, nhiều instance.** Không có trạng thái nghiệp vụ nào được giữ trong RAM giữa các request. Dữ liệu nằm trong PostgreSQL nếu có `DATABASE_URL`, ngược lại nằm trong IndexedDB của trình duyệt giáo viên và được đồng bộ vào từng instance.
- **Đầu vào là đề có sẵn:** `.docx` do giáo viên soạn. Giáo viên nhập đề trước khi giao bài.
- **Thiết bị học sinh là điện thoại** (màn hình nhỏ, cảm ứng, bàn phím ảo) — không phải máy tính phòng máy.
- **Gói miễn phí của Vercel** có giới hạn thời gian chạy function, nên lần đầu vào có thể chậm do cold start.

## Capabilities and Constraints

Đã có (có bằng chứng trong mã nguồn):

- Quản lý lớp; nhập danh sách học sinh từ file; kết quả xuất Excel.
- Quản lý ngân hàng câu hỏi và nhiều bài kiểm tra; chuyển đổi giữa các bài.
- Nhập đề từ `.docx` (kể cả ảnh nhúng trong file Word).
- Bản xem trước sửa được: sửa nội dung/đáp án, chọn đáp án đúng, đổi loại câu (một đáp án / nhiều đáp án / Đúng–Sai), thêm–bớt đáp án, điểm từng câu, bật/tắt từng câu, lọc nhanh *Tất cả / Đọc hoàn hảo / Cần kiểm tra*.
- Công khai đề cho ôn tập (`/on-tap`); học sinh tự làm, nộp và xem điểm/đáp án.
- Xuất bài kiểm tra thành **1 file HTML offline** (chế độ ôn tập hoặc thi 1 lượt, có hẹn giờ, trộn câu/đáp án, chống copy).
- Xem và xuất Excel kết quả thi **cũ** đã lưu trong dữ liệu hiện có (không phát sinh kết quả mới).
- Công thức toán (KaTeX) và ảnh nhúng trong câu hỏi được giữ.

Đã gỡ (không còn trong mã nguồn):

- Thi trực tiếp: chọn tên, mở/đóng phòng, mật khẩu phòng, nộp bài, lưu tiến trình.
- Giám sát thời gian thực qua Socket.IO và duyệt báo cáo chọn nhầm tên.

Ràng buộc kỹ thuật (không được giả định là có thể thay đổi dễ dàng):

- Stack hiện tại: Node.js + Express, giao diện HTML/CSS/JS thuần, lưu trữ PostgreSQL khi có `DATABASE_URL` và file JSON khi chạy local; trên Vercel không có DB thì dữ liệu do trình duyệt giáo viên giữ. Mã nguồn đã trả lời câu hỏi stack, không phải quyết định mở.
- **Phiên xem trước nhập đề nằm trong RAM** — trên serverless nhiều instance, bước xác nhận có thể phải nhập lại file.
- **Body request của Vercel ~4,5 MB** — nhỏ hơn giới hạn 15 MB của file `.docx`.
- Xác thực giáo viên hiện là **một mật khẩu duy nhất** (`TEACHER_PASSWORD`) + cookie ký HMAC.
- Tài liệu Word: không cam kết hỗ trợ mọi định dạng `.docx`.
- Giới hạn file nhập đề: `.docx` ≤ 15 MB; phiên xem trước tự xoá sau 30 phút.
- Chưa giới hạn tần suất ở mọi API (chỉ có ở đăng nhập giáo viên).

Yêu cầu đã xác nhận nhưng **chưa có trong mã nguồn** (không được mô tả như tính năng đang hoạt động):

- **Tách tài khoản riêng cho từng giáo viên.** Người dùng xác nhận cần mỗi giáo viên một tài khoản/mật khẩu riêng và chỉ thấy dữ liệu, lớp của mình, trên cùng một server dùng chung. Hiện tại code chỉ có một `TEACHER_PASSWORD` dùng chung cho toàn bộ server.

Chưa quyết:

- Ai tạo tài khoản giáo viên và bằng cách nào (tự đăng ký / quản trị viên cấp / mời).
- Số lớp và số học sinh đồng thời tối đa cần chịu được.
- Có giữ chế độ lưu bằng file JSON song song với PostgreSQL hay không.

## Brand Commitments

**Không có ràng buộc thương hiệu nào đang ràng buộc.** Người dùng xác nhận tên "Trắc Nghiệm LAN" và `public/logo.svg` (biểu tượng mạng LAN + dấu check) **sẽ được thay** — hãy coi chúng là tạm thời, không phải bản sắc phải bảo toàn.

Chưa có: tên mới, logo mới, giọng điệu, hay bảng màu được người dùng chốt.

## Evidence on Hand

Nội dung thật, có thể dùng làm bằng chứng (đường dẫn trong repo):

- `data/de-mau-test.docx`, `data/de-mau-toan.docx`, `data/de-tin-demo.docx`, `data/de-toan-demo3.docx`, `data/de-toan-mau.docx`, `data/de-toan-thpt-mau2.docx`, `data/mau-cau-hoi.docx` — đề thật của giáo viên.
- `data/questions.json`, `data/mau-cau-hoi.json` — dữ liệu câu hỏi gieo ban đầu.
- `data/exams/*.json` — 8 bài kiểm tra đã tạo.
- `TRIEN-KHAI-RENDER.md` — nhật ký kiểm thử thật (60/60, 61/61, 84/84… theo từng đợt).
- `README.md` — mô tả luồng và các quy tắc nhập đề.

**Không được bịa:** không có testimonial, khách hàng tham chiếu, số liệu benchmark, bảng giá, thông cáo báo chí, hay danh sách trường học. Dữ liệu học sinh thật **không** được commit (đã chặn trong `.gitignore`) nên không có tên học sinh thật để dùng làm ví dụ.

## Product Principles

1. **Không tự bịa dữ liệu.** Khi thiếu căn cứ, sản phẩm báo "cần kiểm tra" và bỏ qua, chứ không đoán. Điều này áp dụng cho cả câu hỏi do máy nhập lẫn nội dung sản phẩm tự viết.
2. **Giáo viên là người quyết định cuối cùng.** Không có gì được ghi vào dữ liệu chính thức trước khi giáo viên xem và xác nhận.
3. **Điện thoại của học sinh là thiết bị chính**, không phải màn hình máy tính — thiết kế cho màn hình nhỏ và thao tác cảm ứng trước.
4. **Đề có sẵn là đầu vào, không phải việc phải làm lại.** Bất kỳ tính năng nào bắt giáo viên gõ lại nội dung họ đã có là đi ngược lại lý do sản phẩm tồn tại.
5. **Tự host, miễn phí, một server cho nhiều giáo viên.** Không phụ thuộc dịch vụ thu phí theo đầu người; hướng tới nhiều giáo viên cùng dùng một server với dữ liệu tách theo từng người.
