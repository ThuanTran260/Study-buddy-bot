import { BoundedMap } from '../../src/utils/boundedMap';

describe('BoundedMap (LRU Bounded Memory)', () => {
  it('stores and retrieves values', () => {
    const map = new BoundedMap<string, number>(3);
    map.set('a', 1);
    expect(map.get('a')).toBe(1);
    expect(map.size).toBe(1);
  });

  it('evicts the least recently used entry when exceeding maxEntries', () => {
    const map = new BoundedMap<string, number>(3);
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);
    map.set('d', 4);

    expect(map.size).toBe(3);
    expect(map.has('a')).toBe(false);
    expect(map.get('b')).toBe(2);
    expect(map.get('d')).toBe(4);
  });

  it('refreshes recency on get() so recently-read entries survive eviction', () => {
    const map = new BoundedMap<string, number>(3);
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);

    // Đọc 'a' -> 'a' trở thành recently-used, 'b' thành LRU
    expect(map.get('a')).toBe(1);

    map.set('d', 4); // 'b' phải bị evict thay vì 'a'

    expect(map.has('a')).toBe(true);
    expect(map.has('b')).toBe(false);
    expect(map.get('d')).toBe(4);
  });

  it('does not evict when updating an existing key', () => {
    const map = new BoundedMap<string, number>(2);
    map.set('a', 1);
    map.set('b', 2);
    map.set('a', 10);

    expect(map.size).toBe(2);
    expect(map.get('a')).toBe(10);
    expect(map.get('b')).toBe(2);
  });

  it('supports chaining from set()', () => {
    const map = new BoundedMap<string, number>(2);
    const returned = map.set('a', 1).set('b', 2);

    expect(returned).toBe(map);
  });

  it('supports delete and has', () => {
    const map = new BoundedMap<string, number>(2);
    map.set('a', 1);
    expect(map.has('a')).toBe(true);
    map.delete('a');
    expect(map.has('a')).toBe(false);
    expect(map.size).toBe(0);
  });

  it('maintains insertion order for iteration', () => {
    const map = new BoundedMap<string, number>(3);
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);

    expect(Array.from(map.keys())).toEqual(['a', 'b', 'c']);
  });

  it('throws when maxEntries is not a positive integer', () => {
    expect(() => new BoundedMap<string, number>(0)).toThrow();
    expect(() => new BoundedMap<string, number>(-1)).toThrow();
    expect(() => new BoundedMap<string, number>(1.5)).toThrow();
  });
});
