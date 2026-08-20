import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Hiển thị danh sách toàn bộ các lệnh và hướng dẫn sử dụng bot');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle('📚 Study Buddy — Hướng Dẫn Sử Dụng Toàn Diện')
    .setDescription('Dưới đây là danh sách các tính năng được phân loại theo từng nhóm công cụ học tập:')
    .setColor(0x5865f2)
    .addFields(
      {
        name: '🧠 Trợ Lý AI (Trí Tuệ Nhân Tạo)',
        value:
          '• `/hoi <cau_hoi> [moi]` — Hỏi đáp kiến thức học tập có ghi nhớ ngữ cảnh (chọn `moi:true` để bắt đầu chủ đề mới)\n' +
          '• `/tomtat <noi_dung>` — Tóm tắt văn bản dài thành các điểm chính (tối đa 4000 ký tự)\n' +
          '• `/tailieu <ten_bo_the> [noi_dung] [file]` — Chuyển đổi bài giảng/tài liệu thành trọn bộ Study Pack (Tóm tắt + Flashcard + Quiz)',
      },
      {
        name: '🎯 Trắc Nghiệm & Ghi Nhớ Lâu Dài (Spaced Repetition)',
        value:
          '• `/quiz <chu_de> [so_cau]` — Làm bài trắc nghiệm AI với các nút bấm tương tác A/B/C/D\n' +
          '• `/flashcard deck-create <ten_bo_the>` — Tạo bộ thẻ nhớ cá nhân mới\n' +
          '• `/flashcard add <ten_bo_the> <mat_truoc> <mat_sau>` — Thêm thẻ thủ công\n' +
          '• `/flashcard ai-generate <ten_bo_the> <chu_de> [so_the]` — Dùng AI sinh bộ thẻ tự động\n' +
          '• `/flashcard review [ten_bo_the]` — Ôn tập thẻ theo thuật toán SuperMemo-2 (Anki)\n' +
          '• `/flashcard share <ten_bo_the> <@user>` — Chia sẻ bộ thẻ cho bạn bè trong server\n' +
          '• `/flashcard list` — Xem danh sách các bộ thẻ và số lượng thẻ đến hạn ôn',
      },
      {
        name: '🍅 Tập Trung & Kênh Thoại Học Nhóm',
        value:
          '• `/pomodoro start [lam] [nghi]` — Khởi động chu kỳ tập trung Pomodoro trong kênh Voice\n' +
          '• `/pomodoro stop` — Dừng phiên Pomodoro\n' +
          '• **Auto Study Room** — Tham gia kênh trigger tạo phòng để tự động mở phòng học riêng',
      },
      {
        name: '📊 Cá Nhân & Xếp Hạng Cộng Đồng',
        value:
          '• `/leaderboard <loai>` — Xem bảng xếp hạng top 10 thành viên server (Streak / Quiz / Pomodoro / Flashcard)\n' +
          '• `/profile [nhac_nho]` — Xem hồ sơ cá nhân: Chuỗi Streak 🔥, Giờ Pomodoro 🍅, Đổi cài đặt nhắc nhở 07:00 AM\n' +
          '• `/digest` — Xem bản tổng kết học tập 7 ngày qua của bạn',
      },
      {
        name: '⚙️ Quản Trị Server (Dành cho Admin)',
        value:
          '• `/config set-study-room <channel>` — Đặt kênh voice trigger tạo phòng tự động\n' +
          '• `/config set-log-channel <channel>` — Đặt kênh text nhận thông báo/log của bot\n' +
          '• `/config set-max-rooms <so_luong>` — Đặt giới hạn số phòng voice mở cùng lúc\n' +
          '• `/config view` — Xem cấu hình hiện tại của Server',
      }
    )
    .setFooter({ text: 'Study Buddy Bot • Nền tảng học tập thông minh' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}
