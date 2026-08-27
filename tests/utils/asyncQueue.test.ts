import { AsyncWorkerQueue } from '../../src/utils/asyncQueue';

describe('AsyncWorkerQueue', () => {
  it('processes jobs with concurrency control and enqueues properly', async () => {
    const processed: string[] = [];
    let runningPeak = 0;
    let currentRunning = 0;

    const queue = new AsyncWorkerQueue<string>('test-queue', 2, async (job) => {
      currentRunning++;
      runningPeak = Math.max(runningPeak, currentRunning);
      await new Promise((resolve) => setTimeout(resolve, 50));
      processed.push(job.data);
      currentRunning--;
    });

    // Enqueue 5 jobs
    const jobs = await Promise.all([
      queue.add('job1', 'data1'),
      queue.add('job2', 'data2'),
      queue.add('job3', 'data3'),
      queue.add('job4', 'data4'),
      queue.add('job5', 'data5'),
    ]);

    expect(jobs.length).toBe(5);

    // Chờ xử lý xong toàn bộ
    while (queue.running > 0 || queue.size > 0) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(processed.length).toBe(5);
    expect(processed).toEqual(['data1', 'data2', 'data3', 'data4', 'data5']);
    expect(runningPeak).toBeLessThanOrEqual(2);
  });

  it('isolates errors without stopping the queue', async () => {
    const processed: string[] = [];

    const queue = new AsyncWorkerQueue<string>('error-queue', 1, async (job) => {
      if (job.data === 'error') {
        throw new Error('Processing failure');
      }
      processed.push(job.data);
    });

    await queue.add('j1', 'success-1');
    await queue.add('j2', 'error');
    await queue.add('j3', 'success-2');

    while (queue.running > 0 || queue.size > 0) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(processed).toEqual(['success-1', 'success-2']);
  });
});
