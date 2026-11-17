# WorkBase: tình trạng dự án và nhật ký thay đổi

Cập nhật: 17/11/2026. Ghi lại những gì đã làm, đang ở đâu, cách chạy, và việc tiếp theo.
Thiết kế chi tiết (kiến trúc, ma trận quyền, API) nằm ở `docs/DESIGN.md` (thư mục `docs/` đang nằm
trong `.gitignore` nên chỉ có trên máy, không lên GitHub).

## 1. Tóm tắt nhanh

WorkBase là web quản lý công việc nội bộ: giao việc cho từng nhân viên, mỗi người một **sheet**
có quyền riêng, cập nhật tiến độ, duyệt, bàn giao, đính kèm file, báo cáo cho quản lý.

| | |
| --- | --- |
| Công nghệ | Next.js 16 + React 19 + TypeScript (giao diện), FastAPI + SQLAlchemy + Alembic (backend), PostgreSQL 16, Docker Compose |
| Ngôn ngữ giao diện | Tiếng Anh. Dữ liệu mẫu bằng tiếng Việt |
| Nhánh | `ui-redesign`. `main` trên GitHub đang ở commit `776d3ee` |
| Chưa commit | Đợt 16 đến 17/11: file đính kèm, "Column access", `CHANGELOG.md` |
| Test | Frontend 515 qua. Backend 719 qua (ruff, mypy sạch) |

## 2. Những gì web đang làm được

### Thanh bên
| Mục | Chức năng |
| --- | --- |
| Home | Lời chào, số việc quá hạn, hạn hôm nay, đang mở, danh sách "Up next", lối tắt |
| My tasks | 5 tab: Assigned to me, Due today, Overdue, Waiting for my review, Following |
| Work summary | Tab "All tasks" và một tab cho mỗi sheet nhân viên (xem mục 3) |
| Reports | Tổng quan cho quản lý: đang mở, quá hạn, hạn hôm nay, chờ duyệt, xong, chưa giao, theo trạng thái, việc của từng người |
| Workspaces | Workspace, base, bảng dữ liệu kiểu Airtable |
| Trash | Việc đã xóa, khôi phục trong 30 ngày |
| Human resources | Nhân viên và phòng ban (chỉ Admin) |

Thanh bên thu gọn được. Chuông thông báo cập nhật tức thời (WebSocket).

### Bảng công việc
- Cột: tên, người phụ trách (kèm avatar), theo dõi, trạng thái, hạn (hiện chữ "Today",
  "Overdue 2 days" kèm màu), ưu tiên, tiến độ, kết quả, file, phản hồi của quản lý.
- Lọc, sắp xếp, ẩn hiện cột, lưu chế độ xem, cố định tiêu đề, tải thêm theo trang.
- Thêm cột, đổi kiểu, quy tắc quyền theo cột.
- **Assign task:** giao một việc cho nhiều người, có bảng xem trước ai được quyền gì.
- **Start / Stop bấm giờ:** người giao bấm Start (việc chuyển sang In progress), nhân viên bấm
  Stop khi xong (việc chuyển sang Pending review). Cột Time có đồng hồ chạy và tổng thời gian.
- **Khung chi tiết bên phải:** thanh trạng thái 4 bước, ai xem được task, việc con, file đính kèm,
  bình luận, lịch sử.

### Quy trình duyệt việc
`To do → In progress → Pending review → Done`
- **Report as done** (người được giao) → **Approve** hoặc **Send back** (người duyệt).
- **Send back bắt buộc ghi lý do.** Lý do thành bình luận trên task, người làm nhận thông báo.
- **Hand over:** bàn giao cho người khác kèm kết quả và tài liệu. Chỉ giao được cho người đã mở
  được bảng (bàn giao không tự cấp quyền).
- **History:** mọi bước được ghi lại (ai, làm gì, lúc nào, giá trị cũ → mới).
- Bấm lặp một nút không làm việc hai lần (mỗi bước kèm số phiên bản). Hai người sửa cùng lúc
  được báo xung đột, không ghi đè âm thầm.

## 3. Sheet và phân quyền

**Sheet** là chế độ xem công việc của một người, dùng chung dữ liệu với bảng "All tasks": sửa ở
đâu cũng cập nhật cả hai nơi, không có bản sao.

| Mức quyền trên sheet | Làm được |
| --- | --- |
| Can view | Xem |
| Can comment | Xem và bình luận |
| Can edit | Thêm, sửa việc (trừ các cột của quản lý), báo hoàn thành |
| Can manage | Thêm: ghi phản hồi, duyệt, bấm giờ, chia sẻ sheet |

- Chủ sheet luôn có tối thiểu quyền Can edit và không bị gỡ được.
- Người Can edit **không** sửa được: Assignee, Follower, Status, Manager feedback, các cột giờ.
- Nhân viên ngoài workspace vẫn mở được sheet mình được cấp. Mở sheet không được cấp: bị từ chối.
- Đổi người phụ trách thì việc chuyển sang sheet khác, người cũ mất quyền xem.
- **Admin hệ thống có toàn quyền:** làm mọi thao tác trên mọi việc (duyệt, báo hoàn thành, xóa
  việc, xóa bình luận, khôi phục thùng rác của người khác). Admin không bị quy tắc cột hạn chế.
- Admin của một workspace tạo và quản lý sheet của bảng thuộc workspace đó.

### Quyền theo cột ("Column access")
Nút **Column access** trên thanh công cụ của bảng (admin workspace và Admin): chọn một người, rồi
mỗi cột chọn *As their role allows*, *Read only* hoặc *Hidden*, lưu một lần.
- Cột bị ẩn biến mất hoàn toàn với người đó: bảng, khung chi tiết, lịch sử, báo cáo, bộ lọc,
  sắp xếp và cả file trong cột đó.
- Quy tắc **chỉ thu hẹp** quyền, không bao giờ cho thêm.

## 4. File đính kèm

- Cột kiểu **Files** (có sẵn trong bảng task mới; bảng cũ thì Add a column → Files).
- Thêm bằng nút **Add files** hoặc kéo thả. Bấm tên file là tải về trực tiếp (không mở cửa sổ khác).
- Giới hạn: 10 MB mỗi file, 20 file mỗi cột. Chấp nhận: pdf, doc/docx, xls/xlsx/xlsm, csv,
  ppt/pptx, txt, md, rtf, odt, ods, png, jpg, gif, webp, zip, 7z, rar. File có thể chạy được
  (html, svg, js, exe, bat, ps1…) bị từ chối.
- Tên file không bao giờ quyết định nơi lưu (lưu dưới khóa ngẫu nhiên).
- Quyền theo cột chứa file: thấy cột thì tải được; có quyền sửa cột thì thêm, xóa được; cột bị ẩn
  thì file không tồn tại với người đó (404), lịch sử cũng không lộ tên file.
- File nằm trong ổ Docker `attachments` (`/data/attachments`), không mất khi khởi động lại.
  Xóa task thì file đi theo. **Sao lưu phải gồm cả cơ sở dữ liệu và ổ này.**
- Thêm file không đổi số phiên bản của task, nên không gây xung đột sửa.

## 5. Nhật ký thay đổi

### 16 đến 17/11/2026 (chưa commit)
- **Đính kèm file** (migration `0012`): kiểu cột `attachment`, bảng `attachments`, API tải lên
  (thân thô, tên trong header `X-File-Name`, không cần thư viện multipart), tải về, xóa; lưu trên
  volume; xóa file khi xóa task; ghi lịch sử "added a file / removed a file". Giao diện
  `AttachmentsField` và liên kết tải trong bảng. Cột "Files" thêm vào mẫu bảng task.
- **Column access:** API `GET/PUT /tables/{id}/field-access[/{user}]` (đặt nhiều cột một lần, hoặc
  không gì cả) và hộp thoại chọn người rồi chọn cột.
- Sửa lỗi trùng khóa React ở Home (hai thẻ cùng trỏ `/workspaces`).
- `Dockerfile` backend tạo sẵn `/data/attachments` cho người dùng `appuser`; `docker-compose.yml`
  thêm volume `attachments` và biến `ATTACHMENTS_DIR`.
- Đẩy `main` lên GitHub (commit `776d3ee`).

### 14 đến 16/11/2026 (đã lên GitHub, `ad6c753` và `776d3ee`)
- **Admin có toàn quyền** (6 chỗ trước đây còn chặn Admin).
- **Quyền cột chỉ thu hẹp** (trước đó "edit" trên một cột có thể mở rộng quyền người chỉ-xem).
- **Lịch sử hoạt động** (migration `0011`), **bàn giao**, **Send back kèm lý do** và thông báo
  `changes_requested`.
- **Reports**, My tasks thêm tab Waiting for my review và Following, ghim sheet và nhớ tab.
- Lệnh `seed-demo`: 4 nhân viên, bảng "Công việc", 6 việc mẫu tiếng Việt, 3 sheet.
- **Sheet có quyền riêng** (migration `0010`), Work summary, Share và Create sheet. Mẫu bảng task
  thêm Priority, Progress update, Result, Manager feedback.
- **Bấm giờ Start/Stop** (migration `0009`).
- **Giao việc (Assign task)**: nhiều người, bảng xem trước quyền; "Who can see this task".
- **Giao diện mới:** bảng màu xanh `#2563EB`, font Be Vietnam Pro, thanh bên trắng thu gọn được,
  trang Home mới, hạn hiển thị bằng chữ, các nhóm cột gọn hơn.

## 6. Cách chạy

Bật Docker Desktop, rồi trong thư mục `work-space`:
```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```
Mở http://localhost:3000. Tài khoản mẫu (mật khẩu chung do chủ dự án giữ, không ghi vào repo):
`QL01` (quản lý), `NV101`, `NV102`, `NV103` (nhân viên), `DEMOADMIN` (Admin).

Nạp dữ liệu mẫu (chạy lại không thêm trùng):
```powershell
docker exec -e SEED_DEMO_PASSWORD=<mat-khau> work-space-backend-1 python -m app.cli seed-demo
```

Kiểm tra (máy chưa cài Node nên chạy trong Docker):
```powershell
docker exec -u root -e NODE_ENV=test work-space-frontend-1 npm test
docker exec -u root work-space-frontend-1 npm run lint
docker exec -u root work-space-frontend-1 npm run typecheck
```
Backend chạy trong container `python:3.12-slim` nối mạng `work-space_default` (xem README).
Đổi cấu trúc dữ liệu thì khởi động lại backend để chạy migration. Thêm thư mục route mới thì
khởi động lại frontend. Dockerfile đổi thì `up -d --build backend`.

## 7. Migration

| Số | Nội dung |
| --- | --- |
| 0009 | Hai vai trò cột `timer_start`, `timer_stop` cho bấm giờ |
| 0010 | Bảng `sheets`, `sheet_members`; vai trò cột `feedback`; lý do `sheet` trong `record_viewers` |
| 0011 | Bảng `activity_log`, `handovers`; thông báo `changes_requested` |
| 0012 | Bảng `attachments`; kiểu cột `attachment`; hai hành động lịch sử về file |

## 8. Kiểm thử

- Frontend: 515 test qua (vitest), lint và kiểm tra kiểu sạch.
- Backend: bộ đầy đủ ngày 17/11 là **719 test qua**, cộng ruff, kiểm tra định dạng và mypy sạch.
  Lần chạy đầu có 1 test cũ lỗi vì bảng công việc đã thêm cột "Files"; test đã sửa và chạy lại qua.
- Đã chạy thật trên server (qua cổng 3000) với tài khoản mẫu: luồng admin → sheet → giao việc →
  cập nhật → báo hoàn thành → duyệt → báo cáo; tải file lên, tải về, xóa; chọn cột cho một người.

## 9. Chưa làm (theo thứ tự đề xuất)

1. Trạng thái Tạm dừng và Có vướng mắc; việc hoàn thành không cần duyệt (cấu hình theo bảng).
2. Sửa trực tiếp trong ô bảng, chọn nhiều dòng, sao chép/dán, kéo độ rộng và đổi thứ tự cột.
3. Checklist trong task; người phối hợp là một vai trò riêng.
4. Mục tài liệu/SOP; chế độ Kanban, lịch, timeline; số trong báo cáo bấm được.
5. Xuất file (chạy nền), tìm kiếm toàn hệ thống (ô tìm trên cùng chưa hoạt động), nhắc hạn.
6. File: xem trước trên trình duyệt, quét virus, file lớn hơn 10 MB (cần chỉnh proxy), ảnh thu nhỏ.
7. Vận hành: log có mã truy vết, quy trình sao lưu và khôi phục, cấu hình production có HTTPS và
   bí mật tách khỏi mã, giao diện điện thoại.

## 10. Việc đang chờ quyết định

- **Giao việc có tự cấp quyền xem không?** Brief ghi: không. Code hiện tại (ADR 0003): người được
  giao luôn mở được task đó. Đổi lại sẽ ảnh hưởng cách giao việc cho người ngoài workspace.
- **Ngôn ngữ giao diện:** brief ghi tiếng Việt, hiện giữ tiếng Anh theo lựa chọn trước đó.

## 11. Cần nhớ

- Cấu hình git của repo đang dùng danh tính `bravic2829-beep` (theo các commit cũ). Đẩy lên
  GitHub phải đăng nhập, nên bạn tự chạy: `git push origin HEAD:main`.
- `docs/` và `AGENTS.md`, `CLAUDE.md` nằm trong `.gitignore`.
- Không commit `.env`. Mật khẩu mẫu chỉ dùng trên máy.
