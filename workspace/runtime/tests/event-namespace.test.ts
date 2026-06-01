/**
 * 单元测试：event-namespace（RFC-003 §3.5）。
 */

import { describe, expect, it } from 'vitest';
import {
  parseEventName,
  isKnownNamespace,
  isNamespaceError,
  KNOWN_NAMESPACES,
} from '../src/event-namespace';

describe('parseEventName', () => {
  it('should parse a well-formed event name', () => {
    // act
    const r = parseEventName('event:item-used');

    // assert
    expect(isNamespaceError(r)).toBe(false);
    if (!isNamespaceError(r)) {
      expect(r.namespace).toBe('event');
      expect(r.name).toBe('item-used');
      expect(r.raw).toBe('event:item-used');
    }
  });

  it('should accept all known namespaces', () => {
    for (const ns of KNOWN_NAMESPACES) {
      const r = parseEventName(`${ns}:foo`);
      expect(isNamespaceError(r)).toBe(false);
    }
  });

  it('should reject events without colon', () => {
    const r = parseEventName('noprefix');
    expect(isNamespaceError(r)).toBe(true);
    if (isNamespaceError(r)) expect(r.code).toBe('INVALID_PARAMS');
  });

  it('should reject events with empty namespace', () => {
    const r = parseEventName(':foo');
    expect(isNamespaceError(r)).toBe(true);
  });

  it('should reject events with empty event name', () => {
    const r = parseEventName('event:');
    expect(isNamespaceError(r)).toBe(true);
  });

  it('should reject unknown namespaces', () => {
    const r = parseEventName('unknown:foo');
    expect(isNamespaceError(r)).toBe(true);
    if (isNamespaceError(r)) expect(r.message).toContain('Unknown event namespace');
  });

  it('should preserve nested colons in event name', () => {
    const r = parseEventName('ws:chat:message');
    if (!isNamespaceError(r)) {
      expect(r.namespace).toBe('ws');
      expect(r.name).toBe('chat:message');
    }
  });
});

describe('isKnownNamespace', () => {
  it('should recognize all listed namespaces', () => {
    for (const ns of KNOWN_NAMESPACES) {
      expect(isKnownNamespace(ns)).toBe(true);
    }
  });

  it('should reject unknown values', () => {
    expect(isKnownNamespace('foo')).toBe(false);
    expect(isKnownNamespace('')).toBe(false);
  });
});
