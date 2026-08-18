import { VoiceChannel } from 'discord.js';
import { logger } from '../utils/logger';

export enum PomodoroStatus {
  WORK = 'WORK',
  BREAK = 'BREAK',
  STOPPED = 'STOPPED',
}

export class PomodoroStateMachine {
  private status: PomodoroStatus = PomodoroStatus.WORK;
  private readonly workMinutes: number;
  private readonly breakMinutes: number;

  constructor({ workMinutes, breakMinutes }: { workMinutes: number; breakMinutes: number }) {
    if (workMinutes < 1 || workMinutes > 120) throw new Error('workMinutes must be between 1 and 120');
    if (breakMinutes < 1 || breakMinutes > 60) throw new Error('breakMinutes must be between 1 and 60');
    this.workMinutes = workMinutes;
    this.breakMinutes = breakMinutes;
  }

  getStatus(): PomodoroStatus { return this.status; }
  getDurationMs(): number {
    return (this.status === PomodoroStatus.WORK ? this.workMinutes : this.breakMinutes) * 60_000;
  }
  advancePhase(): PomodoroStatus {
    this.status = this.status === PomodoroStatus.WORK ? PomodoroStatus.BREAK : PomodoroStatus.WORK;
    return this.status;
  }
  stop(): void { this.status = PomodoroStatus.STOPPED; }
}

export const activeTimers = new Map<string, NodeJS.Timeout>();

export async function safeRenameChannel(channel: VoiceChannel, newName: string): Promise<boolean> {
  try {
    await channel.setName(newName);
    return true;
  } catch (error) {
    logger.warn('Rate limited when renaming voice channel', { channelId: channel.id, error: String(error) });
    return false;
  }
}
