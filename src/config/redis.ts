import Redis, { RedisOptions } from 'ioredis';
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

// Nếu có biến môi trường REDIS_URL (thường là từ Upstash/Render)
// Chúng ta sẽ dùng URL đó, ngược lại mặc định kết nối localhost cho dev
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisClient = new Redis(redisUrl, redisOptions);

redisClient.on('connect', () => {
  logger.info('🟢 Đã kết nối thành công tới Redis (Upstash/Local)');
});

redisClient.on('error', (err) => {
  logger.error('🔴 Lỗi kết nối Redis', { error: String(err) });
});

export default redisClient;
