# Context Engineering Prompt — Discord Bot: AI Q&A + Trợ lý Học tập

> Copy prompt này cho AI coding assistant (Claude Code, Cursor...). Điền các phần
> `[ĐIỀN Ở ĐÂY]` trước khi dùng. Làm theo từng phase ở mục 11, đừng đưa AI code hết
> 1 lần.

---

## 1. VAI TRÒ & BỐI CẢNH

```
Bạn là Senior Backend Engineer có kinh nghiệm xây dựng Discord bot production-grade
bằng discord.js, và có kinh nghiệm tích hợp AI API (Anthropic/OpenAI) vào ứng dụng
thực tế.

Bạn đang giúp một sinh viên năm 3 xây dựng "Study Buddy Bot" — bot Discord kết hợp
AI Q&A và các công cụ hỗ trợ học tập, để đưa vào CV xin thực tập. Đây là project thứ
3 sau Expense Tracker (web full-stack) và Todo List, nên mục tiêu là thể hiện kỹ năng
KHÁC: tích hợp AI, xử lý sự kiện real-time (Discord Gateway), thiết kế command
interaction.

Ưu tiên: code chạy ổn định 24/7 không crash vặt, xử lý lỗi từ AI API (timeout, rate
limit) một cách graceful, không để bot "treo" khi có lỗi.
```

---

## 2. TECH STACK

| Layer | Công nghệ |
|---|---|
| Bot framework | discord.js v14 (Slash Commands + Interactions) |
| Runtime | Node.js |
| Database | PostgreSQL + Prisma ORM (tái dùng kinh nghiệm từ Expense Tracker) |
| AI | Anthropic API (Claude) hoặc OpenAI API — chọn 1, đọc kỹ pricing/rate limit trước |
| Testing | Jest (unit test cho command logic, tách riêng khỏi phần gọi Discord API) |
| Deploy | Railway hoặc VPS (Discord bot cần chạy liên tục 24/7, KHÔNG dùng serverless/Vercel vì bot cần giữ kết nối WebSocket liên tục tới Discord Gateway) |
| CI | GitHub Actions (lint + test trước khi deploy) |

> Lưu ý quan trọng: bot Discord khác web app ở chỗ nó phải là **long-running process**
> giữ kết nối WebSocket liên tục — không deploy được lên nền tảng serverless như
> Vercel/Netlify. Dùng Railway/Render (loại "Worker"/"Background service", không phải
> "Web service") hoặc VPS.

---

## 3. YÊU CẦU CHỨC NĂNG — chia theo phase (bắt buộc làm đúng thứ tự)

### Phase 1 — MVP (làm trước, đơn giản, không phụ thuộc DB)

```
/hoi <câu hỏi>
  - Gửi câu hỏi tới AI API, trả lời ngay trong Discord (dùng Embed cho đẹp)
  - Bắt buộc dùng deferReply() trước khi gọi AI (Discord yêu cầu phản hồi trong 3s,
    mà gọi AI API thường lâu hơn) rồi editReply() khi có kết quả

/tomtat <văn bản dán vào>
  - Tóm tắt đoạn văn bản người dùng paste trực tiếp vào (CHƯA cần upload file ở
    phase này)
  - Giới hạn độ dài input hợp lý (ví dụ tối đa 4000 ký tự) để tránh lạm dụng/tốn
    chi phí API

/pomodoro start [phút làm] [phút nghỉ]
  - Bot đổi tên 1 voice channel chỉ định theo trạng thái: "🍅 Đang tập trung
    (25:00)" -> đếm ngược -> "☕ Giờ nghỉ (5:00)"
  - /pomodoro stop để dừng
  - Lưu ý: Discord giới hạn số lần đổi tên channel (rate limit ~2 lần/10 phút),
    KHÔNG đổi tên mỗi giây — chỉ đổi khi chuyển trạng thái (bắt đầu làm/nghỉ), hiển
    thị thời gian còn lại qua tin nhắn riêng, không nhét vào tên channel liên tục
```

### Phase 2 — Mở rộng (cần Database)

```
/quiz <chủ đề> <số câu hỏi>
  - AI sinh ra bộ câu hỏi trắc nghiệm theo chủ đề, ĐỊNH DẠNG JSON có cấu trúc (yêu
    cầu AI trả về JSON, không phải text tự do, để dễ parse)
  - Hiển thị từng câu bằng Discord Buttons (4 đáp án A/B/C/D), người dùng bấm để
    trả lời
  - Sau khi trả lời: hiện đúng/sai + giải thích ngắn, tính điểm
  - Lưu kết quả (điểm, chủ đề, thời gian) vào DB để có thể xem lịch sử

Auto Study Room
  - Tạo sẵn 1 voice channel đặc biệt "➕ Tạo phòng học" trong server
  - Khi có người join channel đó: bot tự tạo 1 voice channel mới riêng (VD: "📚 Phòng
    học của [tên]"), tự động chuyển người đó vào channel mới
  - Khi channel đó trống (0 người): bot tự xóa channel sau vài giây delay (tránh xóa
    nhầm lúc người dùng đang chuyển đổi giữa các channel)

/lichsu quiz
  - Xem lại lịch sử các lần làm quiz, điểm số theo thời gian
```

### Phase 3 — Nâng cao (optional, chỉ làm nếu Phase 1-2 đã ổn định)

```
- Upload file (PDF/txt) để AI trả lời Q&A dựa trên nội dung tài liệu đó (RAG cơ bản):
  cần vector database (pgvector extension trên PostgreSQL sẵn có, không cần thêm hệ
  thống mới) + bước embedding + retrieval trước khi gọi AI trả lời
- Self-role menu: người dùng bấm nút để tự nhận role theo môn học quan tâm
```

---

## 4. ĐẶC TẢ INTERACTION — quy ước bắt buộc

```
- MỌI lệnh gọi AI API phải dùng interaction.deferReply() ngay đầu, vì Discord yêu
  cầu phản hồi (ack) trong 3 giây, còn gọi AI thường mất vài giây tới chục giây
- Dùng interaction.editReply() để cập nhật kết quả sau khi AI trả lời xong
- Nếu AI API lỗi/timeout: editReply với thông báo lỗi thân thiện (không để loading
  quay mãi, không để bot "im lặng" không phản hồi gì)
- Timeout an toàn cho lệnh gọi AI: nếu quá 15s chưa có phản hồi, tự hủy và báo lỗi
  thay vì để Discord tự báo "app không phản hồi"
- Ephemeral reply (chỉ người gọi lệnh thấy) cho các thông báo lỗi/cá nhân, reply
  công khai cho kết quả quiz/nội dung nên chia sẻ cho cả kênh
```

---

## 5. DATABASE SCHEMA (Prisma)

```
Guild         { id, discordGuildId(unique), studyRoomTriggerChannelId, createdAt }
User          { id, discordUserId(unique), username, createdAt }
QuizSession   { id, userId(FK), guildId(FK), topic, totalQuestions, correctAnswers, createdAt }
QuizQuestion  { id, quizSessionId(FK), question, options(JSON), correctOption, userAnswer, isCorrect }
StudyRoom     { id, guildId(FK), channelId, ownerId(FK), createdAt }   // tracking phòng học tạm
PomodoroSession { id, userId(FK), channelId, workMinutes, breakMinutes, status, startedAt }

Ràng buộc:
- discordGuildId, discordUserId cần unique + index (query theo Discord ID rất nhiều)
- QuizQuestion.options lưu dạng JSON: [{label: "A", text: "..."}, ...]
```

---

## 6. TESTING

```
- Tách riêng "business logic" (tính điểm quiz, parse JSON từ AI, logic pomodoro
  state machine) khỏi phần gọi Discord API -> phần logic thuần viết unit test được
  bằng Jest, không cần mock toàn bộ Discord client phức tạp
- Test các case:
  1. Tính điểm quiz đúng khi user trả lời đúng/sai/không trả lời (timeout)
  2. Parse JSON từ AI trả về đúng cấu trúc mong đợi + xử lý khi AI trả về JSON lỗi
     định dạng (AI đôi khi không tuân thủ 100%, phải có fallback/retry)
  3. Logic pomodoro: chuyển đúng trạng thái work -> break -> work theo thời gian
  4. Rate limit: user spam lệnh /hoi liên tục -> phải bị chặn theo giới hạn đặt ra
     (mục 8)
- KHÔNG cần test thật với Discord Gateway thật trong CI (tốn thời gian, không ổn
  định) — chỉ test business logic + mock các lời gọi Discord API
```

---

## 7. ĐÓNG GÓI & DEPLOY

```
- Dockerfile cho bot (node:20-alpine, chạy `node index.js` làm process chính,
  không cần expose port nào vì bot không nhận HTTP request — chỉ kết nối ra ngoài
  tới Discord Gateway)
- docker-compose.yml gồm: bot service + postgres service
- Đăng ký Slash Commands: dùng SCOPE THEO GUILD (guild-specific) trong lúc phát
  triển để lệnh cập nhật ngay lập tức (global command mất tới 1 giờ để Discord đồng
  bộ) — chỉ chuyển sang global command khi bot đã ổn định và sẵn sàng public
- Deploy lên Railway (loại Worker service, không phải Web service) hoặc VPS, dùng
  PM2 hoặc tương tự để tự restart nếu bot crash
```

---

## 8. BẢO MẬT (áp dụng đúng bài học từ project trước, không lặp lại lỗi cũ)

```
- DISCORD_BOT_TOKEN: nhạy cảm ngang với JWT_SECRET/DB password — tuyệt đối không
  commit, đọc qua process.env, có trong .gitignore + .env.example (chỉ ghi tên biến,
  không ghi giá trị thật)
- Nếu lỡ commit token: vào Discord Developer Portal RESET TOKEN NGAY LẬP TỨC (không
  chỉ xóa khỏi code, vì token cũ vẫn hoạt động cho tới khi bị reset)
- Rate limit lệnh gọi AI theo user (VD: tối đa 10 lần/giờ/user cho /hoi, /tomtat,
  /quiz) — vì mỗi lần gọi AI API tốn tiền thật, không giới hạn sẽ dễ bị lạm dụng/
  spam gây tốn chi phí ngoài ý muốn
- Giới hạn độ dài input người dùng gửi cho AI (chống prompt injection cơ bản và
  giới hạn chi phí token)
- Bot chỉ request đúng Discord Intents cần thiết (VD: GUILD_VOICE_STATES cho tính
  năng study room, KHÔNG bật MESSAGE_CONTENT nếu không cần đọc nội dung tin nhắn
  thường — dùng Slash Command là đủ, giảm phạm vi quyền = giảm rủi ro)
- Một số lệnh (VD: cấu hình studyRoomTriggerChannelId) chỉ admin server mới được
  dùng — kiểm tra permission trước khi thực thi
```

---

## 9. CODING STANDARDS

```
- Cấu trúc thư mục: commands/ (mỗi slash command 1 file) - events/ (xử lý sự kiện
  Discord: ready, voiceStateUpdate...) - services/ (business logic: quizService,
  pomodoroService, aiService) - prisma/ (schema)
- Mỗi command file export: data (SlashCommandBuilder) + execute (hàm xử lý) — pattern
  chuẩn của discord.js, dễ maintain khi số lệnh tăng lên
- Tách phần gọi AI API ra 1 service riêng (aiService.js), để dễ đổi provider
  (Anthropic <-> OpenAI) sau này mà không sửa logic command
- Log lỗi rõ ràng (dùng console.error tối thiểu) kèm context (user nào, lệnh nào,
  lỗi gì) để debug khi bot chạy 24/7 mà không cần truy cập console trực tiếp
```

---

## 10. ĐỊNH NGHĨA HOÀN THÀNH (Definition of Done)

```
[ ] Lệnh chạy đúng, có deferReply cho các lệnh gọi AI, không bị Discord báo "app
    không phản hồi"
[ ] AI API lỗi/timeout được xử lý graceful, bot không crash, không treo
[ ] Rate limit hoạt động đúng khi test spam lệnh liên tục
[ ] DISCORD_BOT_TOKEN và AI API key không xuất hiện ở đâu trong Git history
[ ] Bot restart tự động nếu crash (test bằng cách kill process thủ công, xem có tự
    lên lại không)
[ ] README có hướng dẫn invite bot vào server test + danh sách lệnh
```

---

## 11. CÁCH DÙNG PROMPT NÀY VỚI AI

```
1. Lượt 1: đưa mục 1+2+5 -> dựng project structure + Prisma schema + setup bot cơ
   bản (kết nối Discord, đăng ký 1 lệnh test đơn giản để chắc chắn hoạt động trước)
2. Lượt 2: đưa mục 3 (Phase 1) + mục 4 -> code /hoi, /tomtat, /pomodoro
3. Lượt 3: tự tay test Phase 1 trên server Discord thật của bạn trước khi qua Phase 2
   -> đây là bước KHÔNG ĐƯỢC BỎ QUA, vì Discord có nhiều hành vi chỉ thấy được khi
   chạy thật (rate limit, độ trễ, cách hiển thị Embed...)
4. Lượt 4: đưa mục 3 (Phase 2) -> code /quiz, Auto Study Room
5. Lượt 5: đưa mục 8 -> rà lại bảo mật trước khi invite bot vào server public/thêm
   bạn bè vào test rộng hơn
6. Phase 3 (RAG) chỉ làm nếu còn thời gian — đây là phần khó nhất, đừng ôm vào lúc
   đầu kẻo không kịp các phase cơ bản
```