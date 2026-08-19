# 📚 Study Buddy — Production-Grade Discord Bot

[![Node.js](https://img.shields.io/badge/Node.js-20_LTS-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2.svg)](https://discord.js.org/)
[![Prisma](https://img.shields.io/badge/Prisma-5.22-2D3748.svg)](https://www.prisma.io/)
[![Google Gemini](https://img.shields.io/badge/AI-Gemini_3.5_Flash-orange.svg)](https://aistudio.google.com/)
[![Tests](https://img.shields.io/badge/Tests-18_Passed-success.svg)]()

> Trợ lý học tập thông minh trên Discord dành cho sinh viên: Tích hợp AI hỏi đáp, tóm tắt tài liệu, làm trắc nghiệm tương tác bằng nút bấm (Buttons), quản lý phòng học Voice tự động và chu kỳ Pomodoro.

---

## 🌟 Tính Năng Chính

* 🧠 **Hỏi Đáp AI (`/hoi`)**: Giải đáp thắc mắc học tập với Google Gemini AI, chống spam và tự động phân trang Embed thông minh.
* 📝 **Tóm Tắt Bài Học (`/tomtat`)**: Trích xuất 3–5 điểm chính dạng bullet points từ văn bản dài (tối đa 4000 ký tự).
* 🎯 **Trắc Nghiệm Tương Tác (`/quiz`)**: Sinh bộ câu hỏi trắc nghiệm AI với **Discord Buttons A/B/C/D**, chấm điểm tức thì và lưu bảng điểm vào CSDL.
* 🍅 **Phòng Học Pomodoro (`/pomodoro`)**: Tự động đổi tên kênh thoại theo chu kỳ Học (🍅) $\leftrightarrow$ Nghỉ (☕) kèm cơ chế chống Discord API Rate Limit.
* 🔊 **Auto Study Room**: Tự động tạo phòng thoại riêng cho người dùng và tự hủy khi phòng trống.
* 🩺 **Health Check API**: Endpoint `GET /health` giám sát trạng thái sống của bot và kết nối WebSocket Gateway.

---

## 🏗️ Kiến Trúc Hệ Thống (Architecture)

```
┌────────────────────────────────────────────────────────┐
│                   Discord Gateway v10                  │
└───────────────────────────┬────────────────────────────┘
                            │ WebSocket Events & Interactions
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Discord Interface                    │
│   src/events/ (interactionCreate, voiceStateUpdate)    │
│   src/commands/ (hoi, tomtat, quiz, pomodoro)          │
└───────────────────────────┬────────────────────────────┘
                            │ Pure Business Logic
                            ▼
┌────────────────────────────────────────────────────────┐
│                     Services Layer                     │
│   src/services/ (aiService, quizService, pomodoro)     │
│   src/utils/ (sanitize, rateLimiter, messageSplitter)  │
└───────────────────────────┬────────────────────────────┘
                            │ Data Access
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Prisma ORM Layer                     │
│         PostgreSQL Database (Supabase / Docker)        │
└────────────────────────────────────────────────────────┘
```

---

## 🛡️ Tầng Lớp Bảo Mật (Security Hardening)

1. **Mention Protection**: Mọi phản hồi đều qua hàm `sanitizeDiscordOutput()` và cờ Discord API `allowedMentions: { parse: [] }` triệt tiêu nguy cơ lợi dụng `@everyone`.
2. **In-Memory Rate Limiting**: Giới hạn 10 req/h cho AI, 5 req/h cho Quiz kèm timer tự dọn RAM `unref()`.
3. **Fail-Fast Environment Validation**: Zod schema kiểm tra chặt chẽ biến môi trường khi khởi động.
4. **Resilience & Anti-Crash**: Đăng ký `unhandledRejection` và Graceful Shutdown `SIGINT`/`SIGTERM` đóng Prisma & WebSocket sạch sẽ.
5. **Multi-Stage Docker**: `.dockerignore` cô lập hoàn toàn file bí mật khỏi image production.

---

## 🚀 Hướng Dẫn Cài Đặt & Chạy Cục Bộ

### 1. Yêu cầu môi trường
* Node.js ≥ 20.0.0
* Docker Desktop (hoặc Supabase PostgreSQL URL)

### 2. Cài đặt
```bash
git clone https://github.com/<username>/study-buddy-bot.git
cd study-buddy-bot
npm install
```

### 3. Cấu hình file `.env`
Tạo file `.env` từ mẫu `.env.example`:
```env
DISCORD_TOKEN=your_token_here
CLIENT_ID=your_client_id_here
GUILD_ID=your_test_guild_id

AI_PROVIDER=gemini
AI_API_KEY=your_gemini_api_key
AI_MODEL=gemini-3.5-flash

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/studybuddy?schema=public
HEALTH_PORT=3000
```

### 4. Đồng bộ CSDL & Đăng ký lệnh
```bash
docker compose up postgres -d
npx prisma db push
npm run deploy:commands
```

### 5. Khởi động Bot
```bash
npm run dev
```

---

## 🧪 Kiểm Thử (Unit Tests)

Dự án áp dụng phương pháp TDD (Test-Driven Development) với 100% test pass:

```bash
npm test
npm run test:coverage
```

---

## 📄 Giấy phép
Dự án phát hành dưới giấy phép MIT License.
