# WorkBase (tên tạm)

Nền tảng quản lý công việc và dữ liệu nội bộ (kiểu Notion + Feishu Base). Đã có: xác thực, nhân sự, workspace và bảng dữ liệu, sheet theo từng nhân viên có phân quyền riêng, giao việc, duyệt (kèm lý do khi trả lại), bấm giờ, bàn giao, lịch sử, thông báo, My tasks và báo cáo tổng quan. Tình trạng và nhật ký thay đổi: [`CHANGELOG.md`](CHANGELOG.md). Thiết kế, ma trận quyền, API và phần còn thiếu: `docs/DESIGN.md` (thư mục `docs/` đang bị `.gitignore` bỏ qua).

- Frontend: Next.js (App Router) + TypeScript
- Backend: Python 3.12 + FastAPI (async) + SQLAlchemy 2.x + Alembic
- Database: PostgreSQL 16
- Tài liệu thiết kế: thư mục [`docs/`](docs/) (đọc `docs/context.md`, `docs/usecases.md`, `docs/erd.md`, `docs/flows.md`, `docs/adr/`)
- Quy tắc cho coding agents: [`AGENTS.md`](AGENTS.md), [`CLAUDE.md`](CLAUDE.md)

## Yêu cầu

- Docker Desktop (đang chạy) với Docker Compose
- Để chạy test hoặc phát triển ngoài Docker: Node.js 22 hoặc mới hơn, [uv](https://docs.astral.sh/uv/) (tự cài Python 3.12)

## Chạy toàn bộ bằng Docker

```bash
cp .env.example .env        # rồi đổi POSTGRES_PASSWORD và DATABASE_URL cho khớp nhau
docker compose up -d --build
```

Mật khẩu database chỉ nên gồm chữ và số, vì nó nằm trong `DATABASE_URL`.

| Dịch vụ | Địa chỉ | Ghi chú |
| --- | --- | --- |
| Frontend | http://localhost:3000 | Trang kiểm tra kết nối backend |
| Backend | http://localhost:8000 | Swagger: http://localhost:8000/docs |
| PostgreSQL | localhost:**55432** | Chỉ mở trên localhost. Cổng 55432 để không đụng PostgreSQL có sẵn ở 5432 |

Kiểm tra nhanh:

```bash
curl http://localhost:3000/api/v1/health         # {"status":"ok"}
curl http://localhost:3000/api/v1/health/ready   # {"status":"ok","database":"ok"}
docker compose ps                                # cả ba dịch vụ phải "healthy"
```

Backend tự chạy `alembic upgrade head` mỗi lần khởi động. Dừng: `docker compose down` (dữ liệu giữ trong volume `pgdata`; thêm `-v` để xóa cả dữ liệu).

## Tạo tài khoản Super Admin đầu tiên và đăng nhập

Chưa có trang đăng ký. Tài khoản đầu tiên được tạo bằng lệnh (chạy khi database đã chạy và migration đã áp dụng; stack Docker tự áp dụng migration khi backend khởi động):

```bash
docker compose exec backend python -m app.cli seed-superadmin --employee-code ADMIN001 --full-name "Ten Cua Ban"
```

Lệnh sẽ hỏi mật khẩu (tối thiểu 8 ký tự). Có thể đặt biến `SEED_ADMIN_PASSWORD` thay vì nhập tay. Mật khẩu **không** nhận qua tham số vì sẽ nằm lại trong lịch sử shell. Nếu đã có owner thì lệnh từ chối và không đổi gì.

Sau đó mở http://localhost:3000/login và đăng nhập bằng mã nhân viên và mật khẩu vừa đặt. Super Admin vào được mục **Human resources** để tạo phòng ban và nhân viên. Mỗi nhân viên được tạo đều có tài khoản và workspace cá nhân riêng. Chưa có đổi mật khẩu hay quên mật khẩu trong MVP.

### Dữ liệu mẫu (tiếng Việt)

Sau khi có Super Admin, thêm 4 nhân viên (QL01 quản lý sheet của NV101, NV102, NV103), bảng "Vận hành / Thương mại điện tử / Công việc" và 6 công việc mẫu:

```bash
docker compose exec -e SEED_DEMO_PASSWORD=<mat-khau-it-nhat-8-ky-tu> backend python -m app.cli seed-demo
```

Chạy lại lần nữa sẽ không thêm gì. Đăng nhập bằng mã nhân viên (ví dụ `NV101`) và mật khẩu vừa đặt.

## Phát triển và kiểm thử

Tất cả lệnh dưới đây chạy từ thư mục gốc repo.

**Backend** (cần database chạy: `docker compose up -d db`):

```bash
cd backend
uv sync                                  # cài thư viện đúng phiên bản trong uv.lock
uv run pytest                            # test (dùng PostgreSQL thật, database tạm riêng, khoảng 15 giây)
uv run ruff check . && uv run ruff format --check .
uv run mypy
uv run uvicorn app.main:app --reload     # chạy API ở http://localhost:8000
```

Migration (chỉ một người tạo migration tại một thời điểm, xem `docs/adr/0004`):

```bash
uv run alembic revision --autogenerate -m "mo ta ngan"
uv run alembic upgrade head
uv run alembic downgrade -1
```

**Frontend**:

```bash
cd frontend
npm ci
npm run dev          # http://localhost:3000, proxy /api/* sang http://localhost:8000
npm run lint && npm run typecheck && npm test
npm run build
```

Khi chạy `npm run dev`, backend phải chạy ở cổng 8000 (bằng Docker hoặc `uvicorn`).

## Cấu trúc

```text
backend/     FastAPI (app/api, app/core, app/db, app/modules/<module>), alembic/, tests/, scripts/ (đo hiệu năng)
frontend/    Next.js (src/app, src/features/<tính năng>, src/lib)
docs/        Tài liệu sản phẩm, thiết kế, ADR, TASKS.md
docker-compose.yml, .env.example
```

## Lưu ý

- Không commit `.env` hoặc secret thật. `.env.example` chỉ chứa giá trị giả.
- Trên Windows, nếu mở terminal ở `d:\...` (chữ thường) và test frontend lỗi "failed to find the current suite", cứ chạy `npm test`: script đã tự dùng đường dẫn chuẩn.
