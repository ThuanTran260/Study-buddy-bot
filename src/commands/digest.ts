import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { buildWeeklyDigestEmbed } from '../services/weeklyDigestService';
import { logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('digest')
  .setDescription('Xem tổng kết báo cáo tiến độ học tập 7 ngày qua của bạn');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // ⏱️ Ack ephemeral trước mọi I/O: buildWeeklyDigestEmbed truy vấn DB, tránh Unknown interaction (10062)
  await interaction.deferReply({ ephemeral: true });

  try {
    const embed = await buildWeeklyDigestEmbed(interaction.user.id);
    if (!embed) {
      await interaction.editReply({
        content:
          '📝 Bạn chưa có dữ liệu học tập nào trong 7 ngày qua. Hãy làm vài bài `/quiz` hoặc bật `/pomodoro` nhé!',
      });
      return;
    }

    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    logger.error('Error executing /digest', { userId: interaction.user.id, error: String(error) });
    await interaction.editReply({ content: '❌ Có lỗi xảy ra khi tạo báo cáo tuần.' });
  }
}
