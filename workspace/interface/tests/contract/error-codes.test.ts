import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  HANDSHAKE_REJECT_CODES,
} from '../../src/protocol/error-codes';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const RFC_PATH = resolve(
  HERE,
  '../../../../docs/rfcs/rfc-001-protocol-and-core-communication.md',
);

/**
 * Try to dynamically locate the §4.2 error-code table and parse the row
 * names. If the format drifts we fall back to a grep-style assertion.
 *
 * Table format expected:
 *   ### 4.2 错误码定义
 *
 *   | Code | 含义 | 触发条件 |
 *   |------|------|----------|
 *   | `TIMEOUT` | ... | ... |
 */
function parseErrorCodeTable(rfc: string): string[] {
  const sectionStart = rfc.indexOf('### 4.2');
  if (sectionStart < 0) return [];
  const after = rfc.slice(sectionStart);
  const sectionEnd = after.indexOf('\n### ');
  const section = sectionEnd < 0 ? after : after.slice(0, sectionEnd);

  const codes: string[] = [];
  const rowRegex = /^\|\s*`([A-Z_]+)`\s*\|/gm;
  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(section)) !== null) {
    const code = match[1];
    if (code !== undefined) codes.push(code);
  }
  return codes;
}

describe('ERROR_CODES contract', () => {
  it('should expose exactly 14 codes (audit baseline)', () => {
    // act / assert
    expect(ERROR_CODES.length).toBe(14);
  });

  it('should not contain duplicate entries', () => {
    // act / assert
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it('should cover every error code documented in RFC-001 §4.2', async () => {
    // arrange
    const rfc = await readFile(RFC_PATH, 'utf8');
    const documented = parseErrorCodeTable(rfc);

    // assert — fail loudly if the parser found nothing (drift detection)
    expect(documented.length).toBeGreaterThan(0);

    // assert — every documented code is present in ERROR_CODES (the spec
    // wins). Note: ERROR_CODES may have ADDITIONAL codes documented
    // elsewhere (e.g. PAYLOAD_TOO_LARGE in RFC-003, HANDSHAKE_REJECTED used
    // by the SDK to wrap reui:handshake-reject); that direction is checked
    // in the grep-style fallback below.
    for (const code of documented) {
      expect(ERROR_CODES).toContain(code);
    }
  });

  it('should have every documented ERROR_CODES entry referenced in RFC-001 OR RFC-003', async () => {
    // arrange — every protocol-facing code has a documented home. The
    // SDK-internal `HANDSHAKE_REJECTED` is excluded — it's the outward
    // wrapper code the SDK uses when surfacing `reui:handshake-reject`
    // to plugin authors and is documented in error-codes.ts JSDoc.
    const rfc1 = await readFile(RFC_PATH, 'utf8');
    const rfc3Path = resolve(
      HERE,
      '../../../../docs/rfcs/rfc-003-runtime-services.md',
    );
    const rfc3 = await readFile(rfc3Path, 'utf8').catch(() => '');
    const corpus = `${rfc1}\n${rfc3}`;
    const sdkOnly = new Set<string>(['HANDSHAKE_REJECTED']);

    // assert — every non-SDK-only code appears verbatim in at least one RFC.
    for (const code of ERROR_CODES) {
      if (sdkOnly.has(code)) continue;
      expect(
        corpus.includes(code),
        `expected RFC-001 or RFC-003 to mention ${code}`,
      ).toBe(true);
    }
  });
});

describe('HANDSHAKE_REJECT_CODES contract', () => {
  it('should be a strict subset of ERROR_CODES', () => {
    // act / assert
    for (const code of HANDSHAKE_REJECT_CODES) {
      expect(ERROR_CODES).toContain(code);
    }
  });

  it('should not contain duplicates', () => {
    // act / assert
    expect(new Set(HANDSHAKE_REJECT_CODES).size).toBe(
      HANDSHAKE_REJECT_CODES.length,
    );
  });

  it('should be smaller than ERROR_CODES (strict subset, not equal)', () => {
    // act / assert
    expect(HANDSHAKE_REJECT_CODES.length).toBeLessThan(ERROR_CODES.length);
  });
});
