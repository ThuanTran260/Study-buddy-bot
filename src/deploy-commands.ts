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
      console.log(`Deploying commands to Guild: ${env.guildId}...`);
      await rest.put(Routes.applicationGuildCommands(env.clientId, env.guildId), { body: commands });
      console.log('✅ Guild commands deployed successfully!');
    } else {
      console.log('Deploying Global commands...');
      await rest.put(Routes.applicationCommands(env.clientId), { body: commands });
      console.log('✅ Global commands deployed!');
    }
  } catch (error) {
    console.error('Failed to deploy commands:', error);
  }
})();
