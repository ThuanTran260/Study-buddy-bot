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
