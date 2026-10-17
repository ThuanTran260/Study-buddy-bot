import type { RepliableInteraction } from 'discord.js';

/**
 * Deletes the public deferred placeholder, then sends `content` as an ephemeral follow-up.
 * A failed deleteReply (e.g. placeholder already gone) is ignored so the notice is still delivered.
 */
export async function sendEphemeralAfterDefer(
  interaction: RepliableInteraction,
  content: string
): Promise<void> {
  await interaction.deleteReply().catch(() => {});
  await interaction.followUp({ content, ephemeral: true, allowedMentions: { parse: [] } });
}
