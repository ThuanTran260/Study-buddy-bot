import { Events, Interaction } from 'discord.js';
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
]);

export const name = Events.InteractionCreate;

export async function execute(interaction: Interaction): Promise<void> {
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
