import { REST, Routes } from 'discord.js';
import { env } from './config/env';
import { data as hoiData } from './commands/hoi';
import { data as tomtatData } from './commands/tomtat';
import { data as pomodoroData } from './commands/pomodoro';
import { data as quizData } from './commands/quiz';

const commands = [hoiData.toJSON(), tomtatData.toJSON(), pomodoroData.toJSON(), quizData.toJSON()];
const rest = new REST().setToken(env.discordToken);

(async () => {
  try {
    if (env.guildId) {
      console.log(`🚀 Đang đăng ký Slash Commands cho Guild ID: ${env.guildId}...`);
      await rest.put(Routes.applicationGuildCommands(env.clientId, env.guildId), { body: commands });
      console.log('✅ Đã đăng ký thành công toàn bộ Slash Commands vào Server của bạn!');
    } else {
      console.log('🌍 Đang đăng ký Global Slash Commands (có thể mất tối đa 1 giờ để đồng bộ)...');
      await rest.put(Routes.applicationCommands(env.clientId), { body: commands });
      console.log('✅ Đã đăng ký Global Commands thành công!');
    }
  } catch (error: any) {
    if (error.code === 50001) {
      console.error('\n❌ LỖI: DiscordAPIError[50001] — Missing Access (Thiếu quyền truy cập vào Server).');
      console.error('🔍 Nguyên nhân chính: Bot CHƯA ĐƯỢC MỜI vào Server hoặc được mời nhưng thiếu quyền "applications.commands".\n');
      console.error('👉 KHẮC PHỤC NGAY: Hãy mở đường link bên dưới trên trình duyệt để mời bot vào Server:');
      console.error(`🔗 https://discord.com/oauth2/authorize?client_id=${env.clientId}&permissions=8&scope=bot+applications.commands\n`);
      console.error('Sau khi mời bot vào server xong, bạn hãy chạy lại lệnh: npm run deploy:commands');
    } else {
      console.error('❌ Lỗi khi đăng ký Slash Commands:', error);
    }
  }
})();
