import Redis, { RedisOptions } from 'ioredis';
import RedisMock from 'ioredis-mock';
import { logger } from '../utils/logger';

/**
 * Cấu hình Redis Connection an toàn, tự động thử lại nếu đứt kết nối
 */
const redisOptions: RedisOptions = {
  retryStrategy(times) {
    // 🛑 Bounded Connection Retry: Nếu thử lại quá 20 lần (~1 phút), dừng reconnect để chống CPU/log spam
    if (times > 20) {
      logger.warn(
        'Redis reconnection failed after 20 attempts. Operating in Memory-Fallback mode.'
      );
      return null;
    }
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
  maxRetriesPerRequest: 3, // Giới hạn tối đa 3 lần thử cho mỗi command
};

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisClient =
  process.env.NODE_ENV === 'test' ? new RedisMock() : new Redis(redisUrl, redisOptions);

redisClient.on('connect', () => {
  logger.info('🟢 Đã kết nối thành công tới Redis (Upstash/Local)');
});

redisClient.on('error', (err) => {
  logger.error('🔴 Lỗi kết nối Redis', { error: String(err) });
});

export default redisClient;
