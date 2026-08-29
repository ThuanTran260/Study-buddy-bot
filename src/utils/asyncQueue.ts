import { logger } from './logger';

export interface QueueJob<T> {
  id: string;
  name: string;
  data: T;
}

export type JobProcessor<T> = (job: QueueJob<T>) => Promise<void>;

/**
 * ⚡ In-Process Async Worker Queue với Concurrency Control
 * - 0% Idle Cost (Không tiêu thụ bất kỳ request Redis nào khi nhàn rỗi)
 * - Xử lý đa tác vụ song song với giới hạn concurrency an toàn cho RAM
 * - Tương thích 100% với chữ ký `.add(name, data)` của BullMQ
 */
export class AsyncWorkerQueue<T> {
  private queue: QueueJob<T>[] = [];
  private activeCount = 0;
  private readonly concurrency: number;
  private readonly processor: JobProcessor<T>;
  private readonly queueName: string;
  private jobCounter = 0;

  constructor(queueName: string, concurrency: number, processor: JobProcessor<T>) {
    this.queueName = queueName;
    this.concurrency = Math.max(1, concurrency);
    this.processor = processor;
  }

  /**
   * Đẩy một job mới vào hàng đợi
   */
  add(name: string, data: T): Promise<QueueJob<T>> {
    this.jobCounter++;
    const job: QueueJob<T> = {
      id: `${this.queueName}-${Date.now()}-${this.jobCounter}`,
      name,
      data,
    };

    this.queue.push(job);
    logger.debug(`[${this.queueName}] Enqueued job ${job.id} (Queue size: ${this.queue.length})`);

    // Kích hoạt xử lý bất đồng bộ
    this.processNext();

    return Promise.resolve(job);
  }

  /**
   * Số lượng job đang chờ trong hàng đợi
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Số lượng job đang chạy
   */
  get running(): number {
    return this.activeCount;
  }

  private processNext(): void {
    if (this.activeCount >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift();
    if (!job) return;

    this.activeCount++;

    // Thực thi processor trong Promise độc lập để không block Event Loop
    void (async () => {
      try {
        await this.processor(job);
      } catch (err: unknown) {
        logger.error(`[${this.queueName}] Error processing job ${job.id}`, {
          jobId: job.id,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        this.activeCount--;
        // Tiếp tục xử lý job kế tiếp nếu còn trong hàng đợi
        this.processNext();
      }
    })();
  }
}
