import {
  isControlPrompt,
  buildPatterns,
  classifyEntries,
  loadClassifierConfig,
} from '../classifier.js';
import type { ClassifierConfig } from '../classifier.js';
import type { LogEntry } from '../types.js';

// Default patterns (built from empty config)
const defaultPatterns = buildPatterns({});

describe('isControlPrompt — length threshold', () => {
  it('classifies prompts of exactly 10 chars as control', () => {
    // "add a test" = 10 chars
    expect(isControlPrompt('add a test', defaultPatterns)).toBe(true);
  });

  it('classifies prompts of 11 chars as task (if not in word list)', () => {
    // "add a test!" = 11 chars, not in word list
    expect(isControlPrompt('add a test!', defaultPatterns)).toBe(false);
  });

  it('classifies very short prompts as control', () => {
    expect(isControlPrompt('y', defaultPatterns)).toBe(true);
    expect(isControlPrompt('ok', defaultPatterns)).toBe(true);
    expect(isControlPrompt('', defaultPatterns)).toBe(true); // 0 chars
  });
});

describe('isControlPrompt — word list patterns', () => {
  it('classifies common approval words as control', () => {
    expect(isControlPrompt('yes', defaultPatterns)).toBe(true);
    expect(isControlPrompt('ok', defaultPatterns)).toBe(true);
    expect(isControlPrompt('okay', defaultPatterns)).toBe(true);
    expect(isControlPrompt('sure', defaultPatterns)).toBe(true);
    expect(isControlPrompt('fine', defaultPatterns)).toBe(true);
    expect(isControlPrompt('correct', defaultPatterns)).toBe(true);
    expect(isControlPrompt('agreed', defaultPatterns)).toBe(true);
    expect(isControlPrompt('approved', defaultPatterns)).toBe(true);
    expect(isControlPrompt('done', defaultPatterns)).toBe(true);
  });

  it('classifies positive interjections as control', () => {
    expect(isControlPrompt('perfect', defaultPatterns)).toBe(true);
    expect(isControlPrompt('great', defaultPatterns)).toBe(true);
    expect(isControlPrompt('cool', defaultPatterns)).toBe(true);
    expect(isControlPrompt('awesome', defaultPatterns)).toBe(true);
    expect(isControlPrompt('nice', defaultPatterns)).toBe(true);
    expect(isControlPrompt('good', defaultPatterns)).toBe(true);
  });

  it('classifies multi-word control phrases as control', () => {
    expect(isControlPrompt('go ahead', defaultPatterns)).toBe(true);
    expect(isControlPrompt('looks good', defaultPatterns)).toBe(true);
    expect(isControlPrompt('look good', defaultPatterns)).toBe(true);
    expect(isControlPrompt('sounds good', defaultPatterns)).toBe(true);
    expect(isControlPrompt('sound good', defaultPatterns)).toBe(true);
    expect(isControlPrompt('proceed', defaultPatterns)).toBe(true);
    expect(isControlPrompt('continue', defaultPatterns)).toBe(true);
    expect(isControlPrompt('carry on', defaultPatterns)).toBe(true);
    expect(isControlPrompt('move on', defaultPatterns)).toBe(true);
    expect(isControlPrompt('lgtm', defaultPatterns)).toBe(true);
  });

  it('classifies emoji-only prompts as control', () => {
    expect(isControlPrompt('👍', defaultPatterns)).toBe(true);
    expect(isControlPrompt('👎', defaultPatterns)).toBe(true);
    expect(isControlPrompt('✅', defaultPatterns)).toBe(true);
    expect(isControlPrompt('❌', defaultPatterns)).toBe(true);
    expect(isControlPrompt('🙏', defaultPatterns)).toBe(true);
  });
});

describe('isControlPrompt — anchoring (hybrid prompts are task)', () => {
  it('"yes, fix the bug" is a task prompt (length > 10, no pure pattern match)', () => {
    expect(isControlPrompt('yes, fix the bug', defaultPatterns)).toBe(false);
  });

  it('"go ahead please implement it" does not match anchor', () => {
    expect(isControlPrompt('go ahead please implement it', defaultPatterns)).toBe(false);
  });

  it('"ok, add tests for this function" is a task prompt', () => {
    expect(isControlPrompt('ok, add tests for this function', defaultPatterns)).toBe(false);
  });

  it('"👍 and update the tests" is a task prompt (not emoji-only)', () => {
    expect(isControlPrompt('👍 and update the tests', defaultPatterns)).toBe(false);
  });

  it('"that\'s good, now refactor the helper" is a task prompt', () => {
    expect(isControlPrompt("that's good, now refactor the helper", defaultPatterns)).toBe(false);
  });
});

describe('isControlPrompt — case insensitivity', () => {
  it('classifies uppercase and mixed-case control words', () => {
    expect(isControlPrompt('YES', defaultPatterns)).toBe(true);
    expect(isControlPrompt('Ok', defaultPatterns)).toBe(true);
    expect(isControlPrompt('GO AHEAD', defaultPatterns)).toBe(true);
    expect(isControlPrompt('LGTM', defaultPatterns)).toBe(true);
    expect(isControlPrompt('Looks Good', defaultPatterns)).toBe(true);
  });
});

describe('isControlPrompt — trailing punctuation', () => {
  it('classifies control words with trailing punctuation as control', () => {
    expect(isControlPrompt('yes.', defaultPatterns)).toBe(true);
    expect(isControlPrompt('ok!', defaultPatterns)).toBe(true);
    expect(isControlPrompt('sure?', defaultPatterns)).toBe(true);
    expect(isControlPrompt('proceed!', defaultPatterns)).toBe(true);
    expect(isControlPrompt('lgtm.', defaultPatterns)).toBe(true);
  });
});

describe('buildPatterns — additionalPatterns config', () => {
  it('adds custom patterns from config', () => {
    const config: ClassifierConfig = {
      additionalPatterns: ['^custom phrase$'],
    };
    const patterns = buildPatterns(config);
    expect(isControlPrompt('custom phrase', patterns)).toBe(true);
    // Default patterns still apply
    expect(isControlPrompt('yes', patterns)).toBe(true);
  });

  it('skips invalid regex patterns with a warning', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const config: ClassifierConfig = {
      additionalPatterns: ['[invalid regex', '^valid pattern$'],
    };
    // Should not throw — invalid pattern is skipped
    const patterns = buildPatterns(config);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('invalid regex pattern'),
    );
    // Valid pattern still works
    expect(isControlPrompt('valid pattern', patterns)).toBe(true);
    warnSpy.mockRestore();
  });
});

describe('buildPatterns — excludeDefaults', () => {
  it('excludes defaults when excludeDefaults is true', () => {
    const config: ClassifierConfig = {
      excludeDefaults: true,
      additionalPatterns: ['^custom only$'],
    };
    const patterns = buildPatterns(config);
    // "yes" (3 chars) is still control via length threshold (not via word list)
    expect(isControlPrompt('yes', patterns)).toBe(true); // length 3 <= 10, control via length threshold
    // "proceed" (7 chars) is still control via length threshold
    expect(isControlPrompt('proceed', patterns)).toBe(true); // length 7 <= 10, control via length threshold
    // "looks good" (10 chars) is control via length threshold
    expect(isControlPrompt('looks good', patterns)).toBe(true); // length 10 <= 10, control via length threshold
    // "looks good!" (11 chars) is a task prompt — no defaults, no custom match
    expect(isControlPrompt('looks good!', patterns)).toBe(false); // 11 chars, no defaults, no custom match
    // Custom pattern still works
    expect(isControlPrompt('custom only', patterns)).toBe(true);
  });
});

describe('classifyEntries', () => {
  it('splits entries into taskEntries and controlCount', () => {
    const entries: LogEntry[] = [
      { timestamp: '2026-04-13T10:00:00Z', prompt: 'Implement a retry mechanism with exponential backoff' },
      { timestamp: '2026-04-13T10:01:00Z', prompt: 'yes' },
      { timestamp: '2026-04-13T10:02:00Z', prompt: 'Refactor the database layer to use the repository pattern' },
      { timestamp: '2026-04-13T10:03:00Z', prompt: 'ok' },
      { timestamp: '2026-04-13T10:04:00Z', prompt: 'Add unit tests for the auth module, covering edge cases' },
      { timestamp: '2026-04-13T10:05:00Z', prompt: 'go ahead' },
      { timestamp: '2026-04-13T10:06:00Z', prompt: 'Write a migration script to backfill missing user records' },
      { timestamp: '2026-04-13T10:07:00Z', prompt: 'lgtm' },
      { timestamp: '2026-04-13T10:08:00Z', prompt: 'Create an API endpoint for paginated prompt history retrieval' },
    ];

    const result = classifyEntries(entries);
    expect(result.taskEntries).toHaveLength(5);
    expect(result.controlCount).toBe(4);
    expect(result.taskEntries.every(e => e.prompt.length > 10)).toBe(true);
  });

  it('returns all entries as task when no controls present', () => {
    const entries: LogEntry[] = [
      { timestamp: '2026-04-13T10:00:00Z', prompt: 'Write a migration script for backfilling data' },
      { timestamp: '2026-04-13T10:01:00Z', prompt: 'Add retry logic to the HTTP client with configurable delay' },
      { timestamp: '2026-04-13T10:02:00Z', prompt: 'Implement a webhook receiver that validates HMAC signatures' },
    ];
    const result = classifyEntries(entries);
    expect(result.taskEntries).toHaveLength(3);
    expect(result.controlCount).toBe(0);
  });

  it('returns controlCount equal to all entries when all are control', () => {
    const entries: LogEntry[] = [
      { timestamp: '2026-04-13T10:00:00Z', prompt: 'yes' },
      { timestamp: '2026-04-13T10:01:00Z', prompt: 'ok' },
      { timestamp: '2026-04-13T10:02:00Z', prompt: '👍' },
    ];
    const result = classifyEntries(entries);
    expect(result.taskEntries).toHaveLength(0);
    expect(result.controlCount).toBe(3);
  });

  it('accepts a custom config', () => {
    const entries: LogEntry[] = [
      { timestamp: '2026-04-13T10:00:00Z', prompt: 'Write a migration script for backfilling data' },
      { timestamp: '2026-04-13T10:01:00Z', prompt: 'custom phrase to exclude' },
    ];
    const config: ClassifierConfig = {
      additionalPatterns: ['^custom phrase to exclude$'],
    };
    const result = classifyEntries(entries, config);
    expect(result.taskEntries).toHaveLength(1);
    expect(result.controlCount).toBe(1);
  });
});

describe('isControlPrompt — slash commands', () => {
  it('/clear → true (short, also caught by length threshold)', () => {
    expect(isControlPrompt('/clear', defaultPatterns)).toBe(true);
  });

  it('/compact → true', () => {
    expect(isControlPrompt('/compact', defaultPatterns)).toBe(true);
  });

  it('/help → true', () => {
    expect(isControlPrompt('/help', defaultPatterns)).toBe(true);
  });

  it('/commit → true', () => {
    expect(isControlPrompt('/commit', defaultPatterns)).toBe(true);
  });

  it('/my-skill (hyphenated) → true', () => {
    expect(isControlPrompt('/my-skill', defaultPatterns)).toBe(true);
  });

  it('/clear. (trailing period) → true', () => {
    expect(isControlPrompt('/clear.', defaultPatterns)).toBe(true);
  });

  it('/clear! (trailing exclamation) → true', () => {
    expect(isControlPrompt('/clear!', defaultPatterns)).toBe(true);
  });

  it('/clear fix the bug (task content after command) → false', () => {
    expect(isControlPrompt('/clear fix the bug', defaultPatterns)).toBe(false);
  });

  it('Use /help for docs (slash mid-sentence) → false', () => {
    expect(isControlPrompt('Use /help for docs', defaultPatterns)).toBe(false);
  });

  it('/ (slash then space, no command name) → false', () => {
    // '/ ' (2 chars) is caught by length threshold; use a longer input that bypasses
    // the threshold to verify the regex requires at least one word char after '/'
    expect(isControlPrompt('/ not a slash command', defaultPatterns)).toBe(false);
  });
});
