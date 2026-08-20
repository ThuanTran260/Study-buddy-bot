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

/**
 * Đặt hoặc xóa ghi chú trạng thái (Voice Channel Status) cho kênh thoại mà không làm đổi tên kênh gốc.
 * @param channel Kênh voice của Discord
 * @param status Chuỗi trạng thái hiển thị (để null hoặc rỗng "" để xóa trạng thái)
 */
export async function safeSetVoiceStatus(channel: VoiceChannel, status: string | null): Promise<boolean> {
  try {
    const voiceChan = channel as any;
    if (typeof voiceChan.setStatus === 'function') {
      await voiceChan.setStatus(status ?? '');
      return true;
    }
    if (typeof voiceChan.sendVoiceStatus === 'function') {
      await voiceChan.sendVoiceStatus(status ?? '');
      return true;
    }
    if (channel.client?.rest) {
      await channel.client.rest.put(`/channels/${channel.id}/voice-status` as any, {
        body: { status: status ?? '' },
      });
      return true;
    }
    return false;
  } catch (error) {
    logger.warn('Failed to update voice channel status', { channelId: channel.id, status, error: String(error) });
    return false;
  }
}
