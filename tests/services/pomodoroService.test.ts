import { PomodoroStateMachine, PomodoroStatus } from '../../src/services/pomodoroService';

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
