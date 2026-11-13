# Frontend

Next.js (App Router) + TypeScript strict. Hướng dẫn chạy và kiểm thử nằm ở [README gốc](../README.md).

- `src/app/`: route và layout.
- `src/features/<tính năng>/`: component, hook, gọi API của từng tính năng. Không trộn xác thực và phân quyền vào component.
- `src/lib/`: code dùng chung (ví dụ `api/client.ts` kiểm tra kiểu dữ liệu nhận từ backend).
- Trình duyệt chỉ gọi cùng origin `/api/*`; Next.js chuyển tiếp sang backend (xem `next.config.ts`).
- Next.js 16 khác bản cũ: đọc tài liệu đi kèm trong `node_modules/next/dist/docs/` trước khi dùng API mới.
