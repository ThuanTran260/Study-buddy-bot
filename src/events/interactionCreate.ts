import { Events, Interaction } from 'discord.js';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';
import * as hoiCommand from '../commands/hoi';
import * as tomtatCommand from '../commands/tomtat';
import * as pomodoroCommand from '../commands/pomodoro';
import * as quizCommand from '../commands/quiz';
import * as helpCommand from '../commands/help';
import * as configCommand from '../commands/config';
import * as profileCommand from '../commands/profile';
import * as digestCommand from '../commands/digest';
import * as flashcardCommand from '../commands/flashcard';
import * as leaderboardCommand from '../commands/leaderboard';

const commands = new Map<string, any>([
  ['hoi', hoiCommand],
  ['tomtat', tomtatCommand],
  ['pomodoro', pomodoroCommand],
  ['quiz', quizCommand],
  ['help', helpCommand],
  ['config', configCommand],
  ['profile', profileCommand],
  ['digest', digestCommand],
  ['flashcard', flashcardCommand],
  ['leaderboard', leaderboardCommand],
]);

export const name = Events.InteractionCreate;

export async function execute(interaction: Interaction): Promise<void> {
  // 🛡️ Xử lý các Button Interaction độc lập (Ví dụ: Nút tắt nhắc nhở trong DM)
  if (interaction.isButton()) {
    if (interaction.customId === 'disable_daily_reminder') {
      try {
        await prisma.user.upsert({
          where: { discordUserId: interaction.user.id },
          create: {
            discordUserId: interaction.user.id,
            username: interaction.user.username,
            dailyReminderEnabled: false,
          },
          update: { dailyReminderEnabled: false },
        });

        await interaction.reply({
          content: '🔕 Đã tắt tính năng nhắc nhở ôn tập hàng ngày. Bạn có thể bật lại bất cứ lúc nào bằng lệnh `/profile reminder:on`.',
          ephemeral: true,
        });
      } catch (err) {
        logger.error('Error disabling daily reminder via button', { error: String(err) });
        await interaction.reply({
          content: '❌ Có lỗi khi cập nhật cài đặt nhắc nhở.',
          ephemeral: true,
        }).catch(() => {});
      }
      return;
    }
    // Các button interaction khác thuộc Component Collector (như Quiz A/B/C/D, Flashcard Flip/Rating)
    // sẽ được bắt trực tiếp bởi collector của command tương ứng.
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error('Error executing command', {
      command: interaction.commandName,
      userId: interaction.user.id,
      error: String(error),
    });

    const errorMsg = '❌ Có lỗi khi thực thi lệnh này.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: errorMsg }).catch(() => {});
    } else {
      await interaction.reply({ content: errorMsg, ephemeral: true }).catch(() => {});
    }
  }
}
