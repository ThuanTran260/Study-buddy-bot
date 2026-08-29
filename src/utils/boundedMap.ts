/**
 * 🛡️ Map có trần kích thước với cơ chế eviction LRU (Least Recently Used)
 *
 * Bất biến: size không bao giờ vượt quá maxEntries.
 * - `set()` key mới khi đã đầy -> xóa entry ít dùng nhất (theo thứ tự đọc/ghi gần nhất).
 * - `get()` key tồn tại -> refresh thứ tự recency (entry được đọc lại trở thành mới nhất).
 * - Cập nhật key hiện có -> KHÔNG kích hoạt eviction và refresh recency.
 *
 * Mục tiêu: bảo vệ RAM 512MB cho các In-Memory Fallback Map khi Redis hết quota.
 */
export class BoundedMap<K, V> extends Map<K, V> {
  private readonly maxEntries: number;

  constructor(maxEntries: number, entries?: readonly (readonly [K, V])[]) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error(`maxEntries must be a positive integer, received: ${maxEntries}`);
    }
    super(entries);
    this.maxEntries = maxEntries;
  }

  get(key: K): V | undefined {
    if (!super.has(key)) return undefined;
    const value = super.get(key);

    // Refresh recency: đưa entry xuống cuối thứ tự insertion (LRU thật)
    super.delete(key);
    super.set(key, value as V);

    return value;
  }

  set(key: K, value: V): this {
    if (!super.has(key) && super.size >= this.maxEntries) {
      // Xóa entry LRU cũ nhất (đầu tiên theo insertion-order)
      const oldestKey = super.keys().next().value;
      if (oldestKey !== undefined) super.delete(oldestKey);
    }
    return super.set(key, value);
  }
}
