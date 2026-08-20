import { calculateSM2 } from '../../src/services/sm2Service';

describe('sm2Service (SuperMemo-2 Algorithm)', () => {
  it('handles first successful repetition (repetition=0 -> interval=1, repetition=1)', () => {
    const result = calculateSM2({
      repetition: 0,
      interval: 1,
      easeFactor: 2.5,
      quality: 4,
    });

    expect(result.repetition).toBe(1);
    expect(result.interval).toBe(1);
    expect(result.easeFactor).toBe(2.5);
  });

  it('handles second successful repetition (repetition=1 -> interval=6, repetition=2)', () => {
    const result = calculateSM2({
      repetition: 1,
      interval: 1,
      easeFactor: 2.5,
      quality: 4,
    });

    expect(result.repetition).toBe(2);
    expect(result.interval).toBe(6);
  });

  it('handles third and subsequent successful repetitions (repetition=2, interval=6 -> interval=6*2.5=15)', () => {
    const result = calculateSM2({
      repetition: 2,
      interval: 6,
      easeFactor: 2.5,
      quality: 4,
    });

    expect(result.repetition).toBe(3);
    expect(result.interval).toBe(15);
  });

  it('resets repetition to 0 and interval to 1 when user forgets (quality < 3)', () => {
    const result = calculateSM2({
      repetition: 5,
      interval: 45,
      easeFactor: 2.3,
      quality: 1, // Forgotten
    });

    expect(result.repetition).toBe(0);
    expect(result.interval).toBe(1);
    expect(result.easeFactor).toBeLessThan(2.3);
  });

  it('never drops easeFactor below 1.3 floor', () => {
    let ef = 1.35;
    for (let i = 0; i < 5; i++) {
      const res = calculateSM2({
        repetition: 0,
        interval: 1,
        easeFactor: ef,
        quality: 1,
      });
      ef = res.easeFactor;
    }

    expect(ef).toBe(1.3);
  });

  it('increases easeFactor when quality is 5 (Easy rating)', () => {
    const result = calculateSM2({
      repetition: 1,
      interval: 1,
      easeFactor: 2.5,
      quality: 5,
    });

    expect(result.easeFactor).toBe(2.6);
  });
});
