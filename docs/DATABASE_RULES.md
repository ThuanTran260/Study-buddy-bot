# 📚 STUDY BUDDY BOT — DATABASE RULES & ANTI-PATTERNS

> **CRITICAL**: Đây là tài liệu bắt buộc đọc trước khi thêm bất kỳ code nào tương tác với Prisma/PostgreSQL.
> Tất cả các lỗi được ghi lại ở đây là **lỗi đã xảy ra trong production** và đã được khắc phục.

---

## 🗺️ 1. SƠ ĐỒ FOREIGN KEY — ID MAPPING

```
Discord Layer (Snowflake IDs)              Database Layer (UUID IDs)
───────────────────────────────            ──────────────────────────────
interaction.guildId                        Guild.id        (UUID @id)
  e.g. "1429513747193401511"       ──►    Guild.discordGuildId (UNIQUE)
                                                    ↕ FK
interaction.user.id                        User.id         (UUID @id)
  e.g. "987654321012345678"        ──►    User.discordUserId  (UNIQUE)
                                                    ↕ FK
                                   FlashcardDeck.userId  → User.id
                                   FlashcardDeck.guildId → Guild.id (nullable)
                                   QuizSession.userId    → User.id
                                   QuizSession.guildId   → Guild.id (nullable)
                                   PomodoroSession.userId  → User.id
                                   PomodoroSession.guildId → Guild.id (NOT NULL)
                                   StudyRoom.ownerId     → User.id
                                   StudyRoom.guildId     → Guild.id (NOT NULL)
                                   AiUsageLog.userId     → User.id
```

---

## ⛔ 2. ANTI-PATTERNS — CÁC LỖI CẤM LẶP LẠI

### ❌ ANTI-PATTERN #1: Truyền Discord Snowflake ID thẳng vào FK field

```typescript
// ❌ SAI — interaction.guildId là Discord Snowflake "1429513747193401511"
// FlashcardDeck.guildId là FK → Guild.id (UUID) — KHÔNG KHỚP!
await prisma.flashcardDeck.create({
  data: {
    guildId: interaction.guildId || null,  // ❌ FK VIOLATION → Prisma throws!
  }
});

// ❌ SAI — tương tự với User
await prisma.quizSession.create({
  data: {
    userId: interaction.user.id,  // ❌ Discord Snowflake ≠ User.id UUID!
  }
});
```

### ✅ PATTERN ĐÚNG: Luôn resolve Snowflake → UUID trước khi insert

```typescript
// ✅ ĐÚNG — Dùng helper resolveGuildId() từ src/utils/guildResolver.ts
import { resolveGuildId } from '../utils/guildResolver';

const internalGuildId = await resolveGuildId(interaction.guildId);
await prisma.flashcardDeck.create({
  data: {
    guildId: internalGuildId,  // ✅ UUID nội bộ hoặc null (safe)
  }
});

// ✅ ĐÚNG — User: luôn dùng prisma.user.upsert() để lấy user.id (UUID)
const user = await prisma.user.upsert({
  where: { discordUserId: interaction.user.id },
  create: { discordUserId: interaction.user.id, username: interaction.user.username },
  update: { username: interaction.user.username },
});
await prisma.flashcardDeck.create({
  data: {
    userId: user.id,  // ✅ UUID nội bộ
  }
});
```

---

## 🛠️ 3. HELPER FUNCTIONS — DÙNG BẮT BUỘC

### `resolveGuildId(discordGuildId)` — `src/utils/guildResolver.ts`

| Input | Output |
|---|---|
| `"1429513747193401511"` (Snowflake) | `"301e4b9a-..."` (UUID nội bộ) |
| `null` | `null` |
| Guild chưa tồn tại trong DB | `null` (safe — không throw) |

---

## 📐 4. CHECKLIST TRƯỚC KHI THÊM CODE PRISMA INSERT/UPDATE

- [ ] `userId` field: Phải là `user.id` từ `prisma.user.upsert()` — KHÔNG dùng `interaction.user.id`
- [ ] `guildId` field: Phải là kết quả của `await resolveGuildId(interaction.guildId)` — KHÔNG dùng `interaction.guildId`
- [ ] Transaction safety: Insert nhiều bảng liên quan → dùng `prisma.$transaction()`
- [ ] Unique constraint: Check `@@unique` trước khi create để tránh `P2002`

---

## 🔑 5. UNIQUE CONSTRAINTS & XỬ LÝ P2002

| Model | Unique Constraint | Xử lý khi trùng |
|---|---|---|
| `User` | `discordUserId` | Dùng `upsert()` thay `create()` |
| `Guild` | `discordGuildId` | Dùng `upsert()` thay `create()` |
| `FlashcardDeck` | `(userId, name)` | findUnique trước, hoặc catch `P2002` |
| `StudyRoom` | `channelId` | Check trước khi create |

```typescript
try {
  await prisma.flashcardDeck.create({ data: { ... } });
} catch (e: any) {
  if (e.code === 'P2002') {
    // Đã tồn tại — append hoặc báo lỗi cho user
    return;
  }
  throw e;
}
```

---

## ⚠️ 6. LỊCH SỬ LỖI PRODUCTION

| Sprint | Lỗi | Nguyên nhân | Fix |
|---|---|---|---|
| Sprint 2 | `"❌ Có lỗi xảy ra khi xử lý tài liệu học tập."` | `FlashcardDeck.guildId` nhận Discord Snowflake thay UUID | Tạo `resolveGuildId()`, sửa `tailieu.ts` và `flashcard.ts` |
| Sprint 2 | `"AI chưa thể bóc tách..."` | `JSON.parse` crash vì AI trả về dư `}` | `extractValidJson()` balanced-brace algorithm |
| Sprint 2 | `/tailieu` lỗi với tài liệu có options khác format | AI trả về key-value object thay `{label,text}[]` | Ultra-Resilient normalizer trong `parseStudyPackResponse()` |

---

## 🚫 7. FIELD TUYỆT ĐỐI KHÔNG DÙNG TRỰC TIẾP LÀM FK

| Discord API | ❌ KHÔNG dùng làm FK vào | ✅ Resolve thành |
|---|---|---|
| `interaction.guildId` | `FlashcardDeck.guildId`, `QuizSession.guildId`, `PomodoroSession.guildId`, `StudyRoom.guildId` | `Guild.id` qua `resolveGuildId()` |
| `interaction.user.id` | `FlashcardDeck.userId`, `QuizSession.userId`, `AiUsageLog.userId` | `User.id` qua `prisma.user.upsert()` |
