# AGENTS.md — Study Buddy Discord Bot

Quy tắc bắt buộc cho **MỌI AI coding agent** (opencode, Claude Code, Gemini CLI, Cursor...).
Bản đầy đủ: `.gemini/GEMINI.md` • Anti-patterns CSDL: `docs/DATABASE_RULES.md`

---

## 🚫 GIT POLICY: "Local-First, Ask-to-Exit" (BẤT KHẢ XÂM PHẠM)

Codebase **chưa đủ ổn định để push lên main GitHub**. Mọi commit giữ local để test và fix bug từng bước.

> ⚠️ Lý do kỹ thuật: `.github/workflows/deploy.yml` **tự động deploy Render production ngay khi push main**. Push code chưa ổn định = sập bot production thật.

| Mức | Lệnh |
|-----|------|
| 🚫 Cấm cứng (không chạy kể cả khi được hỏi chung chung) | `git reset --hard`, `git clean -fd`, `git branch -D` |
| ❌ Không tự động — chỉ khi user duyệt tường minh TỪNG lần | `git push` |
| ⚠️ Hỏi trước khi chạy | `git pull`, `git rebase`, `git commit --amend` |
| ✅ Tự do | `add`, `commit`, `status`, `diff`, `log`, `fetch` |

- Commit chỉ được tạo sau khi pass Verification Gate; docs/markdown thuần được miễn gate.
- Commit message theo Conventional Commits: `<type>(<scope>): <mô tả>`.

---

## 📦 PACKAGE MANAGER: PNPM ONLY

Dự án chuẩn hóa pnpm (`"packageManager": "pnpm@11.23.0"` trong package.json). **KHÔNG dùng npm/yarn.**

```bash
pnpm add <pkg>        # không dùng: npm install <pkg>
pnpm dev              # chạy bot
pnpm test             # 29 test suites / 157 tests
pnpm exec tsc --noEmit
pnpm run build
```

---

## ✅ VERIFICATION GATE (trước khi tuyên bố "xong")

1. `pnpm test` → 100% Test Suites PASS
2. `pnpm exec tsc --noEmit` → 0 lỗi TypeScript Strict Mode
3. `pnpm run build` → build sạch, không warning/error

Không có bằng chứng chạy lệnh mới nhất = chưa hoàn thành.

---

## 🔒 SECURITY QUICK RULES

1. Secrets chỉ qua `src/config/env.ts` (Zod validate). Không hardcode token/key.
2. Mọi thao tác sửa/xóa dữ liệu cá nhân phải kiểm tra ownership (`userId`) — chống IDOR.
3. Input user: luôn `setMaxLength()` + sanitize mention (`allowedMentions: { parse: [] }`).
4. Output AI là dữ liệu không tin cậy: bọc `extractValidJson` + validate schema trước khi ghi DB.
5. Rate limit gọi AI lưu DB (`AiUsageLog`), không lưu in-memory.
6. Lỗi trả về Discord che stack trace/table names; log chi tiết qua `logger.error()`.
7. Check-then-act bọc trong `prisma.$transaction` chống race condition.
8. Truyền Discord Snowflake ID thẳng vào FK là lỗi — dùng `resolveGuildId()`/resolver tương ứng.
