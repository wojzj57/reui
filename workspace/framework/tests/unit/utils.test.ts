import { describe, it, expect } from 'vitest';
import { clamp } from '../../src/utils/clamp';
import { classNames } from '../../src/utils/classNames';
import { createId } from '../../src/utils/createId';
import { createShortId, createNumericId } from '../../src/utils/id';

describe('clamp', () => {
  it('returns value within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it('clamps below min', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
  });
  it('clamps above max', () => {
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('classNames', () => {
  it('joins string args', () => {
    expect(classNames('foo', 'bar')).toBe('foo bar');
  });
  it('handles conditional object', () => {
    expect(classNames('foo', { bar: true, baz: false }, 'qux')).toBe('foo bar qux');
  });
  it('skips falsy args', () => {
    expect(classNames('foo', null, undefined, '')).toBe('foo');
  });
});

describe('createId', () => {
  it('produces unique ids', () => {
    const a = createId();
    const b = createId();
    expect(a).not.toBe(b);
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
  });
});

describe('id helpers', () => {
  it('createShortId returns 8 chars', () => {
    expect(createShortId()).toHaveLength(8);
  });
  it('createNumericId returns a number', () => {
    expect(typeof createNumericId()).toBe('number');
  });
});
