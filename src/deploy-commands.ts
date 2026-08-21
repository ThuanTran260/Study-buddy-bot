import { REST, Routes } from 'discord.js';
import { env } from './config/env';
import { data as hoiData } from './commands/hoi';
import { data as tomtatData } from './commands/tomtat';
import { data as pomodoroData } from './commands/pomodoro';
import { data as quizData } from './commands/quiz';
import { data as helpData } from './commands/help';
import { data as configData } from './commands/config';
import { data as profileData } from './commands/profile';
import { data as digestData } from './commands/digest';
import { data as flashcardData } from './commands/flashcard';
import { data as leaderboardData } from './commands/leaderboard';
import { data as tailieuData } from './commands/tailieu';
import { data as studyPlanData } from './commands/study-plan';
import { data as groupData } from './commands/group';

const commands = [
  hoiData.toJSON(),
  tomtatData.toJSON(),
  pomodoroData.toJSON(),
  quizData.toJSON(),
  helpData.toJSON(),
  configData.toJSON(),
  profileData.toJSON(),
  digestData.toJSON(),
  flashcardData.toJSON(),
  leaderboardData.toJSON(),
  tailieuData.toJSON(),
  studyPlanData.toJSON(),
  groupData.toJSON(),
];

const rest = new REST().setToken(env.discordToken);

(async () => {
  try {
    if (env.guildId) {
      console.log(`🚀 Đang đăng ký ${commands.length} Slash Commands cho Guild ID: ${env.guildId}...`);
      await rest.put(Routes.applicationGuildCommands(env.clientId, env.guildId), { body: commands });
      console.log(`✅ Đã đăng ký thành công toàn bộ ${commands.length} Slash Commands vào Server của bạn!`);
    } else {
      console.log(`🌍 Đang đăng ký ${commands.length} Global Slash Commands...`);
      await rest.put(Routes.applicationCommands(env.clientId), { body: commands });
      console.log(`✅ Đã đăng ký thành công ${commands.length} Global Commands!`);
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
