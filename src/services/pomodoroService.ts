import { VoiceChannel, Routes } from 'discord.js';
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
 * Có cơ chế Timeout 2.5s để tuyệt đối không làm treo luồng phản hồi của bot.
 * @param channel Kênh voice của Discord
 * @param status Chuỗi trạng thái hiển thị (để null hoặc rỗng "" để xóa trạng thái)
 */
export async function safeSetVoiceStatus(channel: VoiceChannel, status: string | null): Promise<boolean> {
  const statusStr = status ?? '';
  try {
    const updatePromise = (async () => {
      const voiceChan = channel as any;
      if (typeof voiceChan.setStatus === 'function') {
        return voiceChan.setStatus(statusStr);
      }
      if (typeof voiceChan.sendVoiceStatus === 'function') {
        return voiceChan.sendVoiceStatus(statusStr);
      }
      if (channel.client?.rest) {
        return channel.client.rest.put(Routes.channelVoiceStatus(channel.id), {
          body: { status: statusStr },
        });
      }
      return false;
    })();

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('VOICE_STATUS_TIMEOUT')), 2500)
    );

    await Promise.race([updatePromise, timeoutPromise]);
    return true;
  } catch (error) {
    logger.warn('Failed to update voice channel status (non-critical)', { channelId: channel.id, status, error: String(error) });
    return false;
  }
}
