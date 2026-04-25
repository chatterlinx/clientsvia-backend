/**
 * Unit tests for services/engine/kc/CoreGateLLMJudge.js
 *
 * Covers the pure helpers (cache key, prompt builder, verdict parser) plus
 * the entry-point validation paths that throw tagged error codes WITHOUT
 * making network calls.
 *
 * The actual Groq fetch is not exercised here — it requires GROQ_API_KEY +
 * a live HTTP mock. Live verification happens in C5e on the deployed
 * environment.
 */

const judge = require('../../services/engine/kc/CoreGateLLMJudge');

describe('CoreGateLLMJudge._buildCacheKey', () => {
  test('namespace + companyId + sectionId + md5(rawInput) shape', () => {
    const k = judge._buildCacheKey({
      companyId: 'co123',
      sectionId: 'sec456',
      rawInput:  'Do I have to pay again?',
    });
    expect(k.startsWith('kc:judge:')).toBe(true);
    expect(k).toMatch(/^kc:judge:co123:sec456:[0-9a-f]{32}$/);
  });

  test('different inputs produce different keys (no md5 collision in practice)', () => {
    const a = judge._buildCacheKey({ companyId: 'c', sectionId: 's', rawInput: 'foo' });
    const b = judge._buildCacheKey({ companyId: 'c', sectionId: 's', rawInput: 'bar' });
    expect(a).not.toBe(b);
  });

  test('different tenants → different keys for the same input (multi-tenant isolation)', () => {
    const a = judge._buildCacheKey({ companyId: 'tenant-A', sectionId: 's', rawInput: 'x' });
    const b = judge._buildCacheKey({ companyId: 'tenant-B', sectionId: 's', rawInput: 'x' });
    expect(a).not.toBe(b);
  });

  test('missing companyId/sectionId fall back to placeholders (no crash)', () => {
    expect(() => judge._buildCacheKey({ rawInput: 'x' })).not.toThrow();
    const k = judge._buildCacheKey({ rawInput: 'x' });
    expect(k).toContain(':noco:');
    expect(k).toContain(':nosec:');
  });
});

describe('CoreGateLLMJudge._buildUserPrompt', () => {
  test('includes section label, content, callerPhrases, raw input', () => {
    const p = judge._buildUserPrompt({
      sectionLabel:   'How long is your warranty?',
      sectionContent: 'Our warranty is 10 years on parts and 1 year on labor.',
      callerPhrases:  ['how long is your warranty', 'what is the warranty period'],
      anchorWords:    ['warranty', 'long'],
      rawInput:       'how long is the warranty',
      perPhraseMAX:   0.74,
    });
    expect(p).toContain('How long is your warranty?');
    expect(p).toContain('warranty is 10 years');
    expect(p).toContain('how long is your warranty');
    expect(p).toContain('warranty, long');
    expect(p).toContain('how long is the warranty');
    expect(p).toContain('0.740');
  });

  test('truncates long section content', () => {
    const long = 'x'.repeat(2000);
    const p = judge._buildUserPrompt({
      sectionLabel:   'L',
      sectionContent: long,
      callerPhrases:  [],
      rawInput:       'r',
    });
    // Section content snippet capped at 500 chars; total prompt should be much shorter than 2000.
    expect(p.length).toBeLessThan(1500);
  });

  test('handles empty callerPhrases + anchors gracefully', () => {
    const p = judge._buildUserPrompt({
      sectionLabel:   'L',
      sectionContent: 'C',
      callerPhrases:  [],
      anchorWords:    [],
      rawInput:       'r',
    });
    expect(p).not.toContain('Anchor words');
    expect(p).not.toContain('asking things like');
  });
});

describe('CoreGateLLMJudge._parseVerdict', () => {
  test('valid pass verdict', () => {
    const r = judge._parseVerdict('{"verdict":"pass","confidence":0.91,"reason":"close paraphrase"}');
    expect(r.verdict).toBe('pass');
    expect(r.confidence).toBe(0.91);
    expect(r.reason).toBe('close paraphrase');
  });

  test('valid fail verdict', () => {
    const r = judge._parseVerdict('{"verdict":"fail","confidence":0.85,"reason":"different topic"}');
    expect(r.verdict).toBe('fail');
    expect(r.confidence).toBe(0.85);
  });

  test('case-insensitive verdict', () => {
    const r = judge._parseVerdict('{"verdict":"PASS","confidence":0.5,"reason":""}');
    expect(r.verdict).toBe('pass');
  });

  test('clamps confidence into [0,1]', () => {
    const a = judge._parseVerdict('{"verdict":"pass","confidence":2.5,"reason":""}');
    expect(a.confidence).toBe(1);
    const b = judge._parseVerdict('{"verdict":"fail","confidence":-1,"reason":""}');
    expect(b.confidence).toBe(0);
  });

  test('truncates excessively long reason', () => {
    const r = judge._parseVerdict(`{"verdict":"pass","confidence":0.7,"reason":"${'x'.repeat(500)}"}`);
    expect(r.reason.length).toBeLessThanOrEqual(200);
  });

  test('throws JUDGE_PARSE_ERROR on invalid JSON', () => {
    expect(() => judge._parseVerdict('not json')).toThrow();
    try { judge._parseVerdict('not json'); }
    catch (e) { expect(e.code).toBe('JUDGE_PARSE_ERROR'); }
  });

  test('throws JUDGE_BAD_VERDICT on unknown verdict', () => {
    expect(() => judge._parseVerdict('{"verdict":"maybe","confidence":0.5}')).toThrow();
    try { judge._parseVerdict('{"verdict":"maybe","confidence":0.5}'); }
    catch (e) { expect(e.code).toBe('JUDGE_BAD_VERDICT'); }
  });

  test('default confidence when missing', () => {
    const r = judge._parseVerdict('{"verdict":"pass"}');
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });
});

describe('CoreGateLLMJudge.judgeMatch — input validation', () => {
  test('throws JUDGE_UNSUPPORTED_PROVIDER for non-groq provider', async () => {
    await expect(judge.judgeMatch({
      provider: 'cohere',
      model:    'whatever',
      rawInput: 'x',
    })).rejects.toMatchObject({ code: 'JUDGE_UNSUPPORTED_PROVIDER' });
  });

  test('throws JUDGE_NO_MODEL for missing model', async () => {
    await expect(judge.judgeMatch({
      provider: 'groq',
      model:    '',
      rawInput: 'x',
    })).rejects.toMatchObject({ code: 'JUDGE_NO_MODEL' });
  });

  test('throws JUDGE_NO_INPUT for empty rawInput', async () => {
    await expect(judge.judgeMatch({
      provider: 'groq',
      model:    'llama-3.1-8b-instant',
      rawInput: '   ',
    })).rejects.toMatchObject({ code: 'JUDGE_NO_INPUT' });
  });
});

describe('CoreGateLLMJudge module exports', () => {
  test('SYSTEM_PROMPT exists, mentions json (Groq response_format requirement)', () => {
    expect(typeof judge.SYSTEM_PROMPT).toBe('string');
    expect(judge.SYSTEM_PROMPT.toLowerCase()).toContain('json');
  });

  test('SYSTEM_PROMPT defines pass/fail verdicts', () => {
    expect(judge.SYSTEM_PROMPT).toContain('pass');
    expect(judge.SYSTEM_PROMPT).toContain('fail');
  });

  test('CACHE_TTL_S is a positive integer', () => {
    expect(Number.isInteger(judge.CACHE_TTL_S)).toBe(true);
    expect(judge.CACHE_TTL_S).toBeGreaterThan(0);
  });
});
