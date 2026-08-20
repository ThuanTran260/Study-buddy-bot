# 📚 Study Buddy 2.0 — Enterprise-Grade Discord Learning Ecosystem

[![Node.js](https://img.shields.io/badge/Node.js-20_LTS-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2.svg)](https://discord.js.org/)
[![Prisma](https://img.shields.io/badge/Prisma-5.22-2D3748.svg)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-3ECF8E.svg)](https://supabase.com/)
[![Google Gemini](https://img.shields.io/badge/AI-Gemini_3.5_Flash-orange.svg)](https://aistudio.google.com/)
[![Tests](https://img.shields.io/badge/Tests-38_Passed_100%25-success.svg)]()

> **Study Buddy 2.0** là một hệ sinh thái học tập toàn diện trên Discord dành cho sinh viên: Tích hợp **AI sinh nội dung (Google Gemini 3.5 Flash)**, **Thuật toán Spaced Repetition SuperMemo-2 (SM-2)**, **Gamification nuôi chuỗi Streak 🔥**, **Phòng học Voice Pomodoro tự động**, và **Hệ thống Quản trị Đa Server (Multi-Tenant SaaS)**.

---

## 🌟 9 Tính Năng Cốt Lõi (Core Features)

```
                               ┌──────────────────────────────────────────────┐
                               │           STUDY BUDDY 2.0 ECOSYSTEM          │
                               └──────────────────────┬───────────────────────┘
            ┌───────────────────┬─────────────────────┼────────────────────┬───────────────────┐
            ▼                   ▼                     ▼                    ▼                   ▼
    ┌───────────────┐   ┌───────────────┐     ┌───────────────┐    ┌───────────────┐   ┌───────────────┐
    │ 🧠 AI Q&A     │   │ 🎯 AI Quiz    │     │ 🗂️ Flashcard  │    │ 🍅 Pomodoro   │   │ 📊 Profile &  │
    │ & Tóm Tắt     │   │ Buttons       │     │ Thuật toán    │    │ & Auto Voice  │   │ Weekly Digest │
    │ (/hoi,/tomtat)│   │ (/quiz)       │     │ SM-2 (Anki)   │    │ (/pomodoro)   │   │ (/profile)    │
    └───────────────┘   └───────────────┘     └───────────────┘    └───────────────┘   └───────────────┘
```

1. 🧠 **Hỏi Đáp AI (`/hoi`)**: Giải đáp mọi câu hỏi học thuật với Gemini 3.5 Flash, tự động cắt trang Embed chống tràn ký tự.
2. 📝 **Tóm Tắt Bài Học (`/tomtat`)**: Nén tài liệu dài thành 3–5 điểm trọng tâm (bullet points).
3. 🎯 **Trắc Nghiệm Tương Tác (`/quiz`)**: Bộ câu hỏi trắc nghiệm AI với **4 nút bấm A/B/C/D**, tự đếm ngược 30s, chấm điểm và xếp hạng (S/A/B/C/D).
4. 🗂️ **Thẻ Nhớ Spaced Repetition (`/flashcard`)**: 
   * `/flashcard deck-create` / `add`: Quản lý bộ thẻ nhớ cá nhân.
   * `/flashcard ai-generate`: Dùng Gemini AI tự động soạn bộ thẻ song ngữ/chuyên ngành.
   * `/flashcard review`: Giao diện lật thẻ tương tác `[👁️ Show Answer]` và 4 nút đánh giá `[Quên]` / `[Khó]` / `[Tốt]` / `[Rất Dễ]` tính toán ngày ôn tiếp theo qua **thuật toán SuperMemo-2 (SM-2)**.
5. 🍅 **Phòng Học Pomodoro (`/pomodoro`)**: Tự động đổi tên kênh thoại theo chu kỳ Học (🍅) $\leftrightarrow$ Nghỉ (☕) chống Discord API 429.
6. 🔊 **Hệ Thống Tạo Phòng Tự Động (Auto Study Room)**: Tự cấp phòng voice riêng khi vào kênh trigger, tự dọn sạch sau 8 giây khi phòng trống.
7. 🔥 **Gamification & Hồ Sơ Cá Nhân (`/profile`)**: Bảng thành tích học tập tổng hợp: Chuỗi Streak liên tiếp 🔥, tỷ lệ đúng %, giờ Pomodoro và danh hiệu học thuật.
8. 📊 **Báo Cáo Học Tập Tuần (`/digest`)**: Cron Job tự động gửi DM tổng kết tiến độ 7 ngày vào 20:00 tối Chủ Nhật hàng tuần (`Asia/Ho_Chi_Minh`).
9. ⚙️ **Quản Trị Đa Server (`/config`, `/help`)**: Cấu hình kênh trigger voice, kênh log cảnh báo Admin, trần số phòng mở cùng lúc cho từng server.

---

## 🧮 Thuật Toán SuperMemo-2 (SM-2 Algorithm)

Thuật toán tính toán chu kỳ lặp lại ngắt quãng dựa trên độ nhớ $q \in \{1, 3, 4, 5\}$:
$$\text{Ease Factor mới: } EF' = \max\left(1.3, \; EF + \left(0.1 - (5 - q) \times (0.08 + (5 - q) \times 0.02)\right)\right)$$

$$\text{Khoảng cách ngày ôn: } I(n) = \begin{cases} 1 & \text{khi } n = 1 \\ 6 & \text{khi } n = 2 \\ \text{round}(I(n-1) \times EF') & \text{khi } n > 2 \text{ và } q \ge 3 \\ 1 & \text{khi } q < 3 \text{ (quên, reset chu kỳ)} \end{cases}$$

---

## 🛡️ Tầng Lớp Bảo Mật & Độ Bền Vững (7-Layer Security)

1. **User-Centric Data Preservation**: `QuizSession` và `FlashcardDeck` liên kết với `Guild` qua `onDelete: SetNull` $\rightarrow$ Server bị xóa thì toàn bộ lịch sử học tập cá nhân vẫn được bảo toàn 100%.
2. **DB-Backed Rate Limiter**: Giới hạn lượt gọi AI được lưu vào bảng `AiUsageLog` $\rightarrow$ Không bao giờ bị mất trạng thái khi máy chủ restart.
3. **Data Retention & Auto Cleanup**: Cron job 03:00 sáng VN + Hook khởi động tự dọn dẹp các bản ghi log cũ hơn 24h $\rightarrow$ Giữ CSDL Supabase luôn siêu nhẹ (< 10MB).
4. **Timezone Resilience (`Asia/Ho_Chi_Minh`)**: Chuẩn hóa ngày lịch `YYYY-MM-DD` bằng `Intl.DateTimeFormat` $\rightarrow$ Chống gãy Streak khi học đêm muộn.
5. **Mention Exploit Protection**: Sanitizer lọc `@everyone`, `@here` và cờ API `allowedMentions: { parse: [] }`.
6. **Multi-Tenancy Guild Isolation**: Cấu hình động độc lập theo từng server Discord.
7. **Test-Driven Development (TDD)**: 13/13 Test Suites, 38/38 Unit Tests đạt tỷ lệ `PASS 100%`.

---

## 🚀 Hướng Dẫn Cài Đặt & Chạy Cục Bộ

### 1. Yêu cầu môi trường
* Node.js ≥ 20.0.0 LTS
* PostgreSQL (Supabase Cloud hoặc Docker local)

### 2. Cài đặt mã nguồn
```bash
git clone https://github.com/ThuanTran260/Study-buddy-bot.git
cd "Bot Discord"
npm install
```

### 3. Cấu hình biến môi trường (`.env`)
```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_client_id
GUILD_ID=your_test_guild_id

AI_PROVIDER=gemini
AI_API_KEY=your_gemini_api_key
AI_MODEL=gemini-3.5-flash

DATABASE_URL="postgresql://postgres.[ref]:[pass]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&schema=study_buddy"
DIRECT_URL="postgresql://postgres.[ref]:[pass]@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?schema=study_buddy"
HEALTH_PORT=3000
```

### 4. Đồng bộ CSDL & Đăng ký Lệnh
```bash
npx prisma db push
npm run deploy:commands
```

### 5. Chạy Kiểm Thử & Khởi Động
```bash
npm test         # Chạy 38 unit tests
npm run dev      # Khởi động bot ở môi trường phát triển
```

---

## 🧪 Kết Quả Kiểm Thử (Jest Test Results)

```text
PASS tests/services/sm2Service.test.ts
PASS tests/services/aiService.test.ts
PASS tests/utils/messageSplitter.test.ts
PASS tests/services/quizService.test.ts
PASS tests/utils/rateLimiter.test.ts
PASS tests/utils/sanitize.test.ts
PASS tests/services/pomodoroService.test.ts
PASS tests/utils/dateUtils.test.ts
PASS tests/config/env.test.ts
PASS tests/prisma/schema.test.ts
PASS tests/services/cleanupService.test.ts
PASS tests/services/streakService.test.ts
PASS tests/services/dbRateLimiter.test.ts

Test Suites: 13 passed, 13 total
Tests:       38 passed, 38 total
Snapshots:   0 total
Time:        18.705 s
```

---
*Phát triển bởi Trần Thuận • Dự án Portfolio Kỹ Sư Phần Mềm (Study Buddy 2.0)*
