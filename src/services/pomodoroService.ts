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

import { redisClient } from '../config/redis';

export const POMODORO_REDIS_KEY = 'pomodoro:active_sessions';

export interface PomodoroState {
  channelId: string;
  textChannelId: string;
  workMins: number;
  breakMins: number;
  status: PomodoroStatus;
  endsAt: number; // timestamp
}

export const activeTimers = new Map<string, NodeJS.Timeout>();
const localPomodoroFallback = new Map<string, PomodoroState>();

export async function savePomodoroState(channelId: string, state: PomodoroState): Promise<void> {
  localPomodoroFallback.set(channelId, state);
  try {
    await redisClient.hset(POMODORO_REDIS_KEY, channelId, JSON.stringify(state));
  } catch (err) {
    logger.warn('Redis unavailable in savePomodoroState, saved to memory', {
      channelId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getPomodoroState(channelId: string): Promise<PomodoroState | null> {
  try {
    const data = await redisClient.hget(POMODORO_REDIS_KEY, channelId);
    if (data) return JSON.parse(data);
    return localPomodoroFallback.get(channelId) || null;
  } catch {
    return localPomodoroFallback.get(channelId) || null;
  }
}

export async function removePomodoroState(channelId: string): Promise<void> {
  localPomodoroFallback.delete(channelId);
  try {
    await redisClient.hdel(POMODORO_REDIS_KEY, channelId);
  } catch (err) {
    logger.warn('Redis unavailable in removePomodoroState', {
      channelId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getAllPomodoroStates(): Promise<PomodoroState[]> {
  try {
    const data = await redisClient.hgetall(POMODORO_REDIS_KEY);
    if (data && Object.keys(data).length > 0) {
      return Object.values(data).map((v) => JSON.parse(v));
    }
    return Array.from(localPomodoroFallback.values());
  } catch {
    return Array.from(localPomodoroFallback.values());
  }
}

/**
 * Chiến lược thử gọi các API đặt Voice Status có sẵn trên kênh tới (feature-detect).
 * Hỗ trợ 2 tên method khả dọc của discord.js mà không cần ép kiểu.
 */
interface VoiceStatusCapableChannel {
  setStatus?: (status: string) => unknown;
  sendVoiceStatus?: (status: string) => unknown;
}

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
      const voiceChan = channel as VoiceStatusCapableChannel;
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

    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('VOICE_STATUS_TIMEOUT')), 2500);
    });

    try {
      await Promise.race([updatePromise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
    return true;
  } catch (error) {
    logger.warn('Failed to update voice channel status (non-critical)', { channelId: channel.id, status, error: String(error) });
    return false;
  }
}
