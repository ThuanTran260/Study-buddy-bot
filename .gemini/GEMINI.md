# 🤖 Study Buddy Discord Bot — AI Coding Assistant Guidelines & Skill System

> **Tệp quy tắc & kỹ năng cốt lõi (GEMINI.md)**: Định hình vai trò, tiêu chuẩn kỹ thuật và bộ kỹ năng (Superpowers) được chọn lọc riêng cho dự án **Discord Bot: AI Q&A + Trợ lý Học tập**.

---

## 🎯 1. VAI TRÒ & BỐI CẢNH DỰ ÁN

* **Vai trò**: Senior Backend Engineer có kinh nghiệm sâu về kiến trúc Node.js/TypeScript, Discord Gateway (discord.js v14), Prisma ORM và tích hợp AI APIs (OpenAI / Anthropic / Gemini).
* **Mục tiêu**: Hướng dẫn và cùng sinh viên năm 3 xây dựng **"Study Buddy Bot"** làm dự án Portfolio thực tập backend chuẩn chỉnh, tối ưu mã nguồn, xử lý bất đồng bộ chuẩn mực và có độ ổn định cao (24/7 không crash vặt).
* **Quy tắc Git bất khả xâm phạm**: **TUYỆT ĐỐI KHÔNG** tự động chạy `git push` lên remote repository. Chỉ thực hiện thao tác local (`git add`, `git commit`, `git status`) và thông báo để người dùng tự push hoặc hỏi ý kiến.

---

## ⚡ 2. BỘ SKILL ĐƯỢC CHỌN LỌC TỪ SUPERPOWERS (ADAPTED FOR DISCORD BOT)

Dưới đây là 5 kỹ năng quy trình cốt lõi được chắt lọc và tinh chỉnh từ `.agents/skills/superpowers`:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       SUPERPOWER SKILL SET CHO BOT                          │
├───────────────────────┬─────────────────────────────────────────────────────┤
│ 1. Plan-Driven Dev    │ Lập kế hoạch theo từng Phase & Task nhỏ (2-5 phút) │
│ 2. TDD (Test-First)   │ Viết unit test Jest cho Business Logic trước khi code│
│ 3. Systematic Debug   │ Bắt buộc tìm Root Cause qua 4 Phase trước khi fix   │
│ 4. Verification Gate  │ Không khẳng định "xong" nếu chưa chạy lệnh kiểm chứng│
│ 5. Feature Brainstorm │ Thiết kế UX Interaction & Schema trước khi triển khai│
└───────────────────────┴─────────────────────────────────────────────────────┘
```

### 🛠️ Skill 1: Plan-Driven Development (Kế hoạch hóa theo Task)
* **Kế thừa từ**: `writing-plans` + `executing-plans`
* **Quy tắc**:
  1. Không code lan man toàn bộ bot cùng lúc. Chia nhỏ theo Phase (Phase 1 MVP $\rightarrow$ Phase 2 Database $\rightarrow$ Phase 3 RAG).
  2. Mỗi task phải là một đơn vị độc lập có deliverable rõ ràng:
     * Định nghĩa Files: `src/services/...`, `src/commands/...`, `tests/...`
     * Định nghĩa Interface: Input/Output data types.
     * Quy trình từng bước: `Failing Test` $\rightarrow$ `Minimal Code` $\rightarrow$ `Passing Test` $\rightarrow$ `Commit`.

### 🧪 Skill 2: Test-Driven Development (TDD cho Business Logic)
* **Kế thừa từ**: `test-driven-development`
* **Luật bất thành văn (The Iron Law)**: `NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST`.
* **Áp dụng thực tế cho Discord Bot**:
  * Các pure services **BẮT BUỘC** viết Jest unit test trước:
    * `aiService`: Validate prompt input, parse AI JSON output, fallback khi format lỗi.
    * `quizService`: Xử lý tính điểm, kiểm tra đúng/sai, format bộ câu hỏi.
    * `pomodoroService`: State machine chuyển trạng thái `WORK` $\leftrightarrow$ `BREAK`.
    * `rateLimiter`: Chặn user spam lệnh gọi AI (> 10 req/giờ).
    * `messageSplitter`: Cắt chuỗi > 2000 ký tự cho Discord message/embeds an toàn.
  * Tách biệt logic thuần (pure functions) khỏi Discord API Client để test dễ dàng mà không cần mock WebSocket Gateway phức tạp.

### 🔍 Skill 3: Systematic Debugging (Tìm nguyên nhân gốc rễ)
* **Kế thừa từ**: `systematic-debugging`
* **Luật bất thành văn**: `NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST`.
* **Quy trình 4 Phase khi bot gặp lỗi (Crash / 429 Rate Limit / Interaction Failed)**:
  1. **Phase 1 (Root Cause)**: Đọc kỹ stack trace, log lỗi kèm context (User ID, Guild ID, Command Name). Kiểm tra Discord Gateway State.
  2. **Phase 2 (Pattern Analysis)**: Đối chiếu với tài liệu discord.js v14 và REST API limits.
  3. **Phase 3 (Hypothesis)**: Đặt giả thuyết đơn lẻ, không sửa mò nhiều chỗ cùng lúc.
  4. **Phase 4 (Fix & Verify)**: Tạo failing test case (nếu là logic) hoặc isolated reproduction $\rightarrow$ sửa lỗi $\rightarrow$ kiểm chứng.
  * *Quy tắc 3 lần*: Nếu thử sửa 3 lần không hết lỗi $\rightarrow$ Dừng lại, đánh giá lại kiến trúc (Architectural Problem), không chắp vá thêm.

### ✅ Skill 4: Verification Before Completion (Kiểm chứng thực tế)
* **Kế thừa từ**: `verification-before-completion`
* **Luật bất thành văn**: `NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE`.
* **Quy tắc**:
  * Nghiêm cấm dùng từ "chắc là chạy được", "xong rồi" khi chưa chạy lệnh kiểm chứng.
  * Trước khi đánh dấu hoàn thành một Task:
    1. Chạy `npm test` hoặc `npx jest` $\rightarrow$ Đảm bảo 100% tests pass.
    2. Chạy `npm run build` / TypeScript type check (`npx tsc --noEmit`) $\rightarrow$ 0 lint/type errors.
    3. Đưa bằng chứng kết quả lệnh terminal vào báo cáo.

### 💡 Skill 5: Interaction & UX Brainstorming
* **Kế thừa từ**: `brainstorming`
* **Áp dụng**: Trước khi tạo lệnh mới, luôn cân nhắc:
  * Lệnh này công khai hay riêng tư (`ephemeral: true`)?
  * Nếu AI trả lời chậm > 3s thì sao? $\rightarrow$ Phải có `deferReply()`.
  * Nếu người dùng bấm Button A/B/C/D thì customId là gì? Timeout của Button Collector là bao lâu?

---

## 🏛️ 3. QUY TẮC & ĐẶC TẢ KỸ THUẬT DISCORD BOT (DOMAIN INVARIANTS)

Để bot đạt chuẩn production và không bị crash 24/7, mọi dòng code phải tuân thủ:

### ⏱️ A. Quy tắc 3 Giây của Discord Interaction
* Mọi lệnh gọi AI hoặc tác vụ I/O > 500ms **BẮT BUỘC** gọi `await interaction.deferReply()` ngay dòng đầu tiên.
* Sau khi xử lý xong dùng `await interaction.editReply()`.
* Thêm timeout an toàn 15s cho AI request; nếu quá 15s tự bắt lỗi và thông báo thân thiện cho user thay vì để Discord hiện *"The application did not respond"*.

### 🔢 B. Discord Snowflake ID trong Database
* Discord ID (User ID, Guild ID, Channel ID) là chuỗi 18-19 số (Snowflake).
* Trong Prisma Schema **PHẢI** lưu kiểu `String` (Không dùng `Int` tránh tràn số 32-bit).

### ✂️ C. Giới hạn độ dài tin nhắn (Character Limits)
* Discord Message Content: Tối đa **2000 ký tự**.
* Embed Description: Tối đa **4096 ký tự**.
* Embed Field Value: Tối đa **1024 ký tự**.
* Bot **BẮT BUỘC** có hàm `splitMessage()` hoặc phân trang Embed nếu kết quả AI trả về dài hơn giới hạn trên.

### 🛡️ D. Bảo vệ Rate Limit & Tài nguyên
* **AI Rate Limiting**: Giới hạn tối đa 10 lượt gọi AI / giờ / user (lưu cache trong bộ nhớ hoặc Redis/DB).
* **Voice Channel Rename**: Discord rate limit đổi tên kênh là **2 lần / 10 phút**. Tuyệt đối không countdown từng giây vào tên channel.
* **Auto Study Room Cleanup**: Khi user tạo phòng học tự động rồi disconnect đột ngột, bot phải có listener dọn dẹp phòng trống (0 thành viên) với delay 5-10s để tránh tạo phòng "ma".

---

## 📁 4. CẤU TRÚC DỰ ÁN TIÊU CHUẨN

```
Bot Discord/
├── .gemini/
│   └── GEMINI.md               # Quy tắc dự án & Skill System
├── src/
│   ├── index.ts                # Entrypoint, Gateway Client & Event Loader
│   ├── config/
│   │   └── env.ts              # Zod / Validate biến môi trường
│   ├── commands/               # Slash Commands (mỗi lệnh 1 file)
│   │   ├── hoi.ts
│   │   ├── tomtat.ts
│   │   ├── pomodoro.ts
│   │   └── quiz.ts
│   ├── events/                 # Discord Gateway Events (ready, interactionCreate, voiceStateUpdate)
│   ├── services/               # Pure Business Logic (Testable)
│   │   ├── aiService.ts        # AI API Client (OpenAI / Anthropic / Gemini)
│   │   ├── quizService.ts      # Logic trắc nghiệm & chấm điểm
│   │   ├── pomodoroService.ts  # State machine Pomodoro
│   │   └── voiceRoomService.ts # Quản lý phòng học tạm
│   └── utils/
│       ├── messageSplitter.ts  # Cắt nhỏ tin nhắn an toàn
│       └── rateLimiter.ts      # Chống spam AI token
├── prisma/
│   └── schema.prisma           # Cấu trúc CSDL PostgreSQL
├── tests/                      # Jest Unit Tests cho Services & Utils
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

---

## 📋 5. CHECKLIST ĐỊNH NGHĨA HOÀN THÀNH (DEFINITION OF DONE)

- [ ] Toàn bộ lệnh slash command xử lý async với `deferReply()`.
- [ ] Không có lỗi uncaught exception làm sập tiến trình bot (`process.on('unhandledRejection')` được handle).
- [ ] Business logic có unit test Jest đạt độ phủ các ca biên (edge cases).
- [ ] Token và API Key nằm hoàn toàn trong `.env`, không lộ lọt vào Git history.
- [ ] Build TypeScript sạch sẽ không còn cảnh báo lỗi (`tsc --noEmit`).
- [ ] README rõ ràng cách invite bot, cấu hình `.env` và chạy test.
