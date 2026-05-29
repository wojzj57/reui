/**
 * 单元测试：ReUIError 的构造与 instanceof 行为（RFC-001 §4.3）。
 */

import { describe, expect, it } from 'vitest';
import { ReUIError } from '../../src/error';

describe('ReUIError', () => {
  it('should expose code, method and message via Error contract', () => {
    // arrange
    const err = new ReUIError('TIMEOUT', 'http:request', 'boom');

    // act / assert
    expect(err).toBeInstanceOf(ReUIError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('TIMEOUT');
    expect(err.method).toBe('http:request');
    expect(err.message).toBe('boom');
    expect(err.name).toBe('ReUIError');
    expect(err.details).toBeUndefined();
  });

  it('should retain optional details payload when provided', () => {
    // arrange
    const details = { reason: 'kaboom' };

    // act
    const err = new ReUIError('RUNTIME_ERROR', 'plugin:saveState', 'oops', details);

    // assert
    expect(err.details).toBe(details);
  });

  it('should keep instanceof relation across throw/catch', () => {
    // arrange
    const err = new ReUIError('NOT_READY', 'request', 'boom');

    // act
    let caught: unknown = null;
    try {
      throw err;
    } catch (e) {
      caught = e;
    }

    // assert
    expect(caught).toBeInstanceOf(ReUIError);
  });
});
