import Redis, { RedisOptions } from 'ioredis';
import RedisMock from 'ioredis-mock';
import { env } from './env';
import { logger } from '../utils/logger';

/**
 * Cấu hình Redis Connection an toàn, tự động thử lại nếu đứt kết nối
 */
const redisOptions: RedisOptions = {
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: null,
};

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisClient =
  process.env.NODE_ENV === 'test'
    ? (new RedisMock() as unknown as Redis)
    : new Redis(redisUrl, redisOptions);

redisClient.on('connect', () => {
  logger.info('🟢 Đã kết nối thành công tới Redis (Upstash/Local)');
});

redisClient.on('error', (err) => {
  logger.error('🔴 Lỗi kết nối Redis', { error: String(err) });
});

export default redisClient;
