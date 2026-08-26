# 📚 Study Buddy 2.0 — Enterprise-Grade Discord Learning Ecosystem

[![Node.js](https://img.shields.io/badge/Node.js-22_LTS-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2.svg)](https://discord.js.org/)
[![Prisma](https://img.shields.io/badge/Prisma-5.22-2D3748.svg)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-3ECF8E.svg)](https://supabase.com/)
[![Google Gemini](https://img.shields.io/badge/AI-Gemini_3.5_Flash-orange.svg)](https://aistudio.google.com/)
[![Tests](https://img.shields.io/badge/Tests-157_Passed_100%25-success.svg)]()
[![License MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> **Study Buddy 2.0** is an enterprise-grade academic collaboration ecosystem for Discord. It seamlessly integrates **Generative AI (Google Gemini 3.5 Flash)**, the **SuperMemo-2 (SM-2) Spaced Repetition Algorithm**, **Streak Gamification 🔥**, **Dynamic Pomodoro Voice Study Rooms**, and **Multi-Tenant Guild Administration**.

---

## 🌟 9 Core Pillars

```
                               ┌──────────────────────────────────────────────┐
                               │           STUDY BUDDY 2.0 ECOSYSTEM          │
                               └──────────────────────┬───────────────────────┘
            ┌───────────────────┬─────────────────────┼────────────────────┬───────────────────┐
            ▼                   ▼                     ▼                    ▼                   ▼
    ┌───────────────┐   ┌───────────────┐     ┌───────────────┐    ┌───────────────┐   ┌───────────────┐
    │ 🧠 AI Q&A     │   │ 🎯 AI Quiz    │     │ 🗂️ Flashcards │    │ 🍅 Pomodoro   │   │ 📊 Profile &  │
    │ & Summaries   │   │ Buttons       │     │ SuperMemo-2   │    │ & Auto Voice  │   │ Weekly Digest │
    │ (/hoi,/tomtat)│   │ (/quiz)       │     │ Algorithm     │    │ (/pomodoro)   │   │ (/profile)    │
    └───────────────┘   └───────────────┘     └───────────────┘    └───────────────┘   └───────────────┘
```

1. 🧠 **AI Academic Tutor (`/hoi`)**: Instant academic query resolution powered by Gemini 3.5 Flash with intelligent embed chunking preventing Discord character overflow.
2. 📝 **Document Summarizer (`/tomtat`)**: Distills lengthy study materials into structured bullet points with high informational density.
3. 🎯 **Interactive AI Quiz Machine (`/quiz`)**: Generates 4-option multiple-choice quizzes with **interactive ActionRow buttons (A/B/C/D)**, 30-second live timers, and automated grading tiers (S/A/B/C/D).
4. 🗂️ **Spaced Repetition Flashcards (`/flashcard`)**: 
   * `/flashcard deck-create` / `add`: Create and manage custom study decks.
   * `/flashcard ai-generate`: Leverage Gemini AI to automatically generate bilingual or technical card sets.
   * `/flashcard review`: Interactive card flip `[👁️ Show Answer]` with 4 recall rating buttons `[Forgot]` / `[Hard]` / `[Good]` / `[Easy]` scheduling reviews via the **SuperMemo-2 (SM-2)** algorithm.
5. 🍅 **Automated Pomodoro Sessions (`/pomodoro`)**: Manages Focus (🍅) $\leftrightarrow$ Break (☕) cycles with automated Discord voice channel renaming throttled against API 429 rate limits.
6. 🔊 **Dynamic Voice Room Provisioning (Auto Study Room)**: On-demand private voice channel creation triggered upon joining, with 8-second automated garbage collection when empty.
7. 🔥 **Gamification & Academic Profiles (`/profile`)**: Dynamic badge and achievement system tracking continuous Study Streaks 🔥, quiz accuracy %, Pomodoro focus hours, and rank titles.
8. 📊 **Weekly Progress Digest (`/digest`)**: Scheduled node-cron job delivering personalized 7-day performance analytics via DM every Sunday at 20:00 (`Asia/Ho_Chi_Minh`).
9. ⚙️ **Multi-Tenant Guild Administration (`/config`, `/help`)**: Guild-scoped configuration for trigger voice channels, admin audit logging channels, and concurrent room limits.

---

## 🧮 SuperMemo-2 (SM-2) Spaced Repetition Algorithm

Calculates optimal review intervals based on user recall grade $q \in \{1, 3, 4, 5\}$:

$$\text{New Ease Factor: } EF' = \max\left(1.3, \; EF + \left(0.1 - (5 - q) \times (0.08 + (5 - q) \times 0.02)\right)\right)$$

$$\text{Review Interval: } I(n) = \begin{cases} 1 & \text{for } n = 1 \\ 6 & \text{for } n = 2 \\ \text{round}(I(n-1) \times EF') & \text{for } n > 2 \text{ and } q \ge 3 \\ 1 & \text{for } q < 3 \text{ (lapse, reset cycle)} \end{cases}$$

---

## 🛡️ 7-Layer Resilience & Security Architecture

1. **User-Centric Data Preservation**: `QuizSession` and `FlashcardDeck` maintain `Guild` relations with `onDelete: SetNull` $\rightarrow$ Server deletions never erase personal academic progress.
2. **Database-Backed Rate Limiter**: AI rate limits persisted in `AiUsageLog` $\rightarrow$ Throttling state survives process crashes and server restarts.
3. **Data Retention & Auto Cleanup**: Automated daily cron at 03:00 UTC+7 and startup hooks purge stale logs older than 24h $\rightarrow$ Maintains Supabase DB footprint under 10MB.
4. **Timezone Resilience (`Asia/Ho_Chi_Minh`)**: Calendar dates standardized to `YYYY-MM-DD` via `Intl.DateTimeFormat` $\rightarrow$ Prevents late-night streak breakage.
5. **Mention Exploit Protection**: Sanitizer strips `@everyone` and `@here`, complemented by API-level `allowedMentions: { parse: [] }`.
6. **Multi-Tenancy Guild Isolation**: Dynamic guild-specific configurations isolated at the database query level.
7. **Test-Driven Development (TDD)**: 29/29 Test Suites, 157/157 Unit Tests with 100% pass rate.

---

## 🚀 Getting Started

### 1. Prerequisites
* **Node.js ≥ 22.13 LTS** (Required for native `node:sqlite` in pnpm 11)
* **pnpm** (Enabled via `corepack enable`)
* **PostgreSQL** (Supabase Cloud or Docker local)
* **Discord Application & Bot Token** (From Discord Developer Portal)

### 2. Installation
```bash
git clone https://github.com/ThuanTran260/Study-buddy-bot.git
cd "Study-buddy-bot"
pnpm install
```

### 3. Environment Configuration (`.env`)
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

### 4. Database Sync & Command Registration
```bash
pnpm exec prisma db push
pnpm run deploy:commands
```

### 5. Test Suite & Startup
```bash
pnpm test        # Execute 157 unit tests across 29 test suites
pnpm dev         # Launch bot in development mode with nodemon
```

---

## 🧪 Test Suite Results (Jest TDD Suite)

```text
PASS tests/config/env.test.ts
PASS tests/utils/logger.test.ts
PASS tests/utils/dateUtils.test.ts
PASS tests/utils/aiSchema.test.ts
PASS tests/utils/rateLimiter.test.ts
PASS tests/utils/messageSplitter.test.ts
PASS tests/utils/sanitize.test.ts
PASS tests/services/visualService.test.ts
PASS tests/services/streakService.test.ts
PASS tests/services/sm2Service.test.ts
PASS tests/services/quizService.test.ts
PASS tests/services/pomodoroService.test.ts
PASS tests/services/documentService.test.ts
PASS tests/services/dbRateLimiter.test.ts
PASS tests/services/dailyReminderService.test.ts
PASS tests/services/conversationMemory.test.ts
PASS tests/services/cleanupService.test.ts
PASS tests/services/aiService.test.ts
PASS tests/commands/studyPlan.test.ts
PASS tests/commands/leaderboard.test.ts
PASS tests/commands/group.test.ts
PASS tests/prisma/schema.test.ts
PASS tests/simulations/edgeCaseSimulator.test.ts
PASS tests/simulations/databaseEdgeCases.test.ts
PASS tests/simulations/clientEdgeCaseSimulator.test.ts
PASS tests/simulations/adversarialAttackSimulator.test.ts
PASS tests/simulations/userJourneySimulator.test.ts
PASS tests/simulations/flashcardAutocomplete.test.ts
PASS tests/simulations/visualEdgeCases.test.ts

Test Suites: 29 passed, 29 total
Tests:       157 passed, 157 total
Snapshots:   0 total
Time:        4.82s
```

---

<div align="center">
  <sub>Developed with ❤️ by Tran Thuan • Software Engineering Portfolio (Study Buddy 2.0)</sub>
</div>
