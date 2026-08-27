import { PomodoroStateMachine, PomodoroStatus, safeSetVoiceStatus } from '../../src/services/pomodoroService';
import { VoiceChannel } from 'discord.js';

describe('PomodoroStateMachine', () => {
  it('initializes with WORK state and advances to BREAK then back to WORK', () => {
    const sm = new PomodoroStateMachine({ workMinutes: 25, breakMinutes: 5 });
    expect(sm.getStatus()).toBe(PomodoroStatus.WORK);
    sm.advancePhase();
    expect(sm.getStatus()).toBe(PomodoroStatus.BREAK);
    sm.advancePhase();
    expect(sm.getStatus()).toBe(PomodoroStatus.WORK);
  });

  it('calculates duration in milliseconds accurately', () => {
    const sm = new PomodoroStateMachine({ workMinutes: 25, breakMinutes: 5 });
    expect(sm.getDurationMs()).toBe(25 * 60 * 1000);
    sm.advancePhase();
    expect(sm.getDurationMs()).toBe(5 * 60 * 1000);
  });

  it('validates minutes limits', () => {
    expect(() => new PomodoroStateMachine({ workMinutes: 0, breakMinutes: 5 })).toThrow();
    expect(() => new PomodoroStateMachine({ workMinutes: 125, breakMinutes: 5 })).toThrow();
    expect(() => new PomodoroStateMachine({ workMinutes: 25, breakMinutes: 0 })).toThrow();
    expect(() => new PomodoroStateMachine({ workMinutes: 25, breakMinutes: 65 })).toThrow();
  });
});

describe('safeSetVoiceStatus', () => {
  it('calls channel.setStatus with status string', async () => {
    const setStatusMock = jest.fn().mockResolvedValue(undefined);
    const mockChannel = {
      id: 'voice-123',
      setStatus: setStatusMock,
    } as unknown as VoiceChannel;

    const result = await safeSetVoiceStatus(mockChannel, '🍅 Đang tập trung Pomodoro (25m)');
    expect(result).toBe(true);
    expect(setStatusMock).toHaveBeenCalledWith('🍅 Đang tập trung Pomodoro (25m)');
  });

  it('clears status when empty string is passed', async () => {
    const setStatusMock = jest.fn().mockResolvedValue(undefined);
    const mockChannel = {
      id: 'voice-123',
      setStatus: setStatusMock,
    } as unknown as VoiceChannel;

    const result = await safeSetVoiceStatus(mockChannel, '');
    expect(result).toBe(true);
    expect(setStatusMock).toHaveBeenCalledWith('');
  });

  it('falls back to channel.client.rest.put when setStatus method is absent', async () => {
    const putMock = jest.fn().mockResolvedValue(undefined);
    const mockChannel = {
      id: 'voice-123',
      client: {
        rest: {
          put: putMock,
        },
      },
    } as unknown as VoiceChannel;

    const result = await safeSetVoiceStatus(mockChannel, '🍅 Pomodoro');
    expect(result).toBe(true);
    expect(putMock).toHaveBeenCalledWith('/channels/voice-123/voice-status', {
      body: { status: '🍅 Pomodoro' },
    });
  });

  it('returns false gracefully when status update fails', async () => {
    const setStatusMock = jest.fn().mockRejectedValue(new Error('Missing Permissions'));
    const mockChannel = {
      id: 'voice-123',
      setStatus: setStatusMock,
    } as unknown as VoiceChannel;

    const result = await safeSetVoiceStatus(mockChannel, 'Test');
    expect(result).toBe(false);
  });
});

describe('Pomodoro Redis & In-Memory State Resilience', () => {
  const {
    savePomodoroState,
    getPomodoroState,
    removePomodoroState,
    getAllPomodoroStates,
  } = require('../../src/services/pomodoroService');

  it('saves and retrieves state, falls back to memory when Redis fails', async () => {
    const { redisClient } = await import('../../src/config/redis');

    const sampleState = {
      channelId: 'chan-1',
      textChannelId: 'text-1',
      workMins: 25,
      breakMins: 5,
      status: PomodoroStatus.WORK,
      endsAt: Date.now() + 1500000,
    };

    // Khi Redis hoạt động
    await savePomodoroState('chan-1', sampleState);
    const retrieved = await getPomodoroState('chan-1');
    expect(retrieved?.channelId).toBe('chan-1');

    // Giả lập Redis ném lỗi Quota Exceeded
    jest.spyOn(redisClient, 'hset').mockRejectedValue(new Error('ERR max daily request limit exceeded'));
    jest.spyOn(redisClient, 'hget').mockRejectedValue(new Error('ERR max daily request limit exceeded'));
    jest.spyOn(redisClient, 'hgetall').mockRejectedValue(new Error('ERR max daily request limit exceeded'));

    // Vẫn lưu và đọc thành công từ In-Memory Store
    await expect(savePomodoroState('chan-fallback', sampleState)).resolves.not.toThrow();
    const fallbackRetrieved = await getPomodoroState('chan-fallback');
    expect(fallbackRetrieved?.channelId).toBe('chan-1');

    const all = await getAllPomodoroStates();
    expect(all.length).toBeGreaterThan(0);

    await removePomodoroState('chan-fallback');

    jest.restoreAllMocks();
  });
});
