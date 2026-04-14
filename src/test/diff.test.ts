import { computeDiff } from '../diff-util.js';

describe('computeDiff', () => {
  it('identical strings produce no added words', () => {
    const result = computeDiff('hello world', 'hello world');
    expect(result.every(w => !w.added)).toBe(true);
  });

  it('new word in after is marked added: true', () => {
    const result = computeDiff('hello', 'hello world');
    const world = result.find(w => w.text === 'world');
    expect(world).toBeDefined();
    expect(world!.added).toBe(true);
    const hello = result.find(w => w.text === 'hello');
    expect(hello).toBeDefined();
    expect(hello!.added).toBe(false);
  });

  it('empty before string causes all after words to be added', () => {
    const result = computeDiff('', 'hello world');
    expect(result).toHaveLength(2);
    expect(result.every(w => w.added)).toBe(true);
  });
});
