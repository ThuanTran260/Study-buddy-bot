import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { buildWeeklyDigestEmbed } from '../services/weeklyDigestService';
import { logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('digest')
  .setDescription('Xem tổng kết báo cáo tiến độ học tập 7 ngày qua của bạn');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const embed = await buildWeeklyDigestEmbed(interaction.user.id);
    if (!embed) {
      await interaction.reply({
        content: '📝 Bạn chưa có dữ liệu học tập nào trong 7 ngày qua. Hãy làm vài bài `/quiz` hoặc bật `/pomodoro` nhé!',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } });
  } catch (error) {
    logger.error('Error executing /digest', { userId: interaction.user.id, error: String(error) });
    await interaction.reply({ content: '❌ Có lỗi xảy ra khi tạo báo cáo tuần.', ephemeral: true });
  }
}
