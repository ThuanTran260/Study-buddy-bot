# 🚀 HƯỚNG DẪN TRIỂN KHAI CI/CD LÊN RENDER (RENDER.COM DEPLOYMENT GUIDE)

Tài liệu này hướng dẫn từng bước thiết lập luồng **Tự Động Hóa CI/CD (GitHub Actions $\rightarrow$ Render.com)** cho Study Buddy Discord Bot.

---

## 🏗️ 1. TỔNG QUAN LUỒNG CI/CD

```mermaid
graph LR
    Dev[💻 Developer Push Code] -->|git push origin main| GitHub[🐙 GitHub Repository]
    GitHub -->|Trigger| CI[🧪 GitHub Actions CI]
    CI -->|npm test: 19 Suites, 100 Tests| Pass{Pass All Tests?}
    Pass -->|❌ Fail| Reject[🛑 Dừng lại & Báo Lỗi]
    Pass -->|✅ Pass| CD[🚀 Trigger Render Deploy Hook]
    CD --> Render[🌐 Render.com Web Service]
    Render -->|npm install & build| Live[🟢 Study Buddy Bot Online 24/7]
```

---

## 🛠️ 2. CÁC CÁCH TRIỂN KHAI TRÊN RENDER

### Cách 1: Sử dụng Blueprint `render.yaml` (Khuyến nghị — Nhanh nhất)

1. Đăng nhập [Render.com](https://dashboard.render.com/).
2. Chọn **New +** $\rightarrow$ **Blueprint**.
3. Kết nối repository GitHub của bạn (`ThuanTran260/Study-buddy-bot`).
4. Render sẽ tự động đọc file `render.yaml` trong thư mục gốc và cấu hình toàn bộ dịch vụ.

---

### Cách 2: Tạo thủ công Web Service trên Render Dashboard

1. Chọn **New +** $\rightarrow$ **Web Service**.
2. Chọn repo GitHub của bot.
3. Điền các thông số cấu hình:
   * **Name:** `study-buddy-bot`
   * **Region:** `Singapore` (Gần VN nhất để giảm độ trễ Discord Gateway)
   * **Branch:** `main`
   * **Runtime:** `Node`
   * **Build Command:** `npm install && npm run build`
   * **Start Command:** `npm start`
   * **Health Check Path:** `/health`
   * **Plan:** `Free` (hoặc `Starter` $7/tháng để không bao giờ bị sleep)

---

## 🔐 3. CẤU HÌNH BIẾN MÔI TRƯỜNG TRÊN RENDER (ENVIRONMENT VARIABLES)

Vào tab **Environment** trong dashboard của Render Service và thêm các biến:

| Biến môi trường | Ý nghĩa | Ví dụ giá trị |
|---|---|---|
| `NODE_ENV` | Môi trường chạy | `production` |
| `DISCORD_TOKEN` | Bot Token từ Discord Developer Portal | `MTM...` |
| `CLIENT_ID` | Application ID của Bot | `1429...` |
| `GUILD_ID` | Server ID thử nghiệm (tùy chọn) | `1429...` |
| `DATABASE_URL` | Chuỗi kết nối Supabase Pooler (Port 6543) | `postgresql://postgres.[ref]:[pass]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true` |
| `DIRECT_URL` | Chuỗi kết nối trực tiếp Supabase (Port 5432) | `postgresql://postgres.[ref]:[pass]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres` |
| `AI_PROVIDER` | Nhà cung cấp AI (`gemini` hoặc `openai`) | `gemini` |
| `AI_API_KEY` | API Key của Gemini hoặc OpenAI | `AIzaSy...` |
| `AI_MODEL` | Tên mô hình AI | `gemini-3.5-flash` |
| `PORT` | Cổng HTTP cho Healthcheck (Render tự gán) | `10000` |

---

## ⚡ 4. THIẾT LẬP GITHUB ACTIONS SECRETS CHO CI/CD TỰ ĐỘNG

Để GitHub Actions tự động kích hoạt Render mỗi khi bạn commit lên `main`:

1. Trên Render Dashboard, vào service của bạn $\rightarrow$ **Settings** $\rightarrow$ Kéo xuống mục **Deploy Hook** $\rightarrow$ Copy URL (ví dụ: `https://api.render.com/deploy/srv-xxxxxx?key=yyyyyy`).
2. Trên GitHub Repository, vào **Settings** $\rightarrow$ **Secrets and variables** $\rightarrow$ **Actions** $\rightarrow$ **New repository secret**.
3. Thêm secret:
   * **Name:** `RENDER_DEPLOY_HOOK_URL`
   * **Value:** Dán Deploy Hook URL từ bước 1.
4. *(Tùy chọn nếu muốn tự deploy slash commands qua GitHub Actions):* Thêm `DISCORD_TOKEN`, `CLIENT_ID`, `DATABASE_URL`, `AI_API_KEY`, `AI_PROVIDER`.

---

## ⏰ 5. GIẢI PHÁP GIỮ BOT KHÔNG BỊ SLEEP TRÊN RENDER FREE TIER

> [!NOTE]
> Gói Free của Render sẽ tự động "sleep" sau 15 phút không nhận được HTTP request.  
> Study Buddy Bot đã tích hợp sẵn **HTTP Health Check Server** tại cổng `10000` với endpoint `/health`.

Để giữ bot luôn thức 24/7 miễn phí:
1. Đăng ký tài khoản miễn phí tại [Cron-Job.org](https://cron-job.org/) hoặc [UptimeRobot.com](https://uptimerobot.com/).
2. Tạo một cron job ping URL của Render mỗi 5 đến 10 phút một lần:
   * **URL:** `https://study-buddy-discord-bot.onrender.com/health`
   * **Schedule:** Every 5 minutes (`*/5 * * * *`)
   * **HTTP Method:** `GET`
3. Khi nhận request `/health`, bot trả về `{ "status": "ok", "guilds": 1 }` và tiếp tục hoạt động liên tục!

---

## 📜 6. ĐỒNG BỘ CSDL VÀ SLASH COMMANDS SAU KHI DEPLOY

Sau khi Render build xong lần đầu, chạy một lần các lệnh sau tại terminal máy của bạn (hoặc Render Shell):

```bash
# 1. Đẩy migration CSDL lên Supabase
npx prisma db push

# 2. Đăng ký toàn bộ 11 Slash Commands lên Discord Gateway
npm run deploy:commands
```
