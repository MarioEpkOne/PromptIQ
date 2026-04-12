import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// We override the home dir by mocking 'os' — but logger.ts reads promptiqDir at import time.
// Instead, we test the exported helpers with a temp dir.

describe('logger', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptiq-test-'));
    process.env.PROMPTIQ_HOME = tempDir;
  });

  afterEach(() => {
    delete process.env.PROMPTIQ_HOME;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('readTodayEntries returns empty array when file does not exist', async () => {
    // Import fresh after env override
    jest.resetModules();
    const { readTodayEntries } = await import('../logger.js');
    const entries = readTodayEntries();
    expect(entries).toEqual([]);
  });

  it('readTodayEntries skips malformed lines', async () => {
    jest.resetModules();
    const { ensureDirectories, todayLogPath, readTodayEntries } = await import('../logger.js');
    ensureDirectories();
    const today = new Date().toISOString().split('T')[0];
    const filePath = todayLogPath();
    fs.writeFileSync(
      filePath,
      [
        JSON.stringify({ timestamp: '2026-04-10T10:00:00Z', prompt: 'valid prompt' }),
        'not json at all',
        JSON.stringify({ timestamp: '2026-04-10T10:01:00Z', prompt: 'another valid' }),
        '{}', // missing fields
      ].join('\n') + '\n',
      'utf-8',
    );
    const entries = readTodayEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].prompt).toBe('valid prompt');
    expect(entries[1].prompt).toBe('another valid');
  });

  it('ensureDirectories creates all required subdirs', async () => {
    jest.resetModules();
    const { ensureDirectories, promptiqDir } = await import('../logger.js');
    ensureDirectories();
    const base = promptiqDir();
    expect(fs.existsSync(path.join(base, 'daily'))).toBe(true);
    expect(fs.existsSync(path.join(base, 'weekly'))).toBe(true);
    expect(fs.existsSync(path.join(base, 'monthly'))).toBe(true);
  });

  it('runLog appends prompt from stdin as JSON line', async () => {
    jest.resetModules();
    const { ensureDirectories, todayLogPath } = await import('../logger.js');
    ensureDirectories();

    // Simulate stdin by piping a string
    const { Readable } = await import('stream');
    const mockStdin = new Readable({ read() {} });
    mockStdin.push('Hello world prompt\n');
    mockStdin.push(null);

    // Temporarily replace process.stdin
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

    const { runLog } = await import('../logger.js');
    await runLog();

    Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true });

    const filePath = todayLogPath();
    expect(fs.existsSync(filePath)).toBe(true);
    const line = fs.readFileSync(filePath, 'utf-8').trim();
    const entry = JSON.parse(line);
    expect(entry.prompt).toBe('Hello world prompt');
    expect(entry.timestamp).toBeTruthy();
  });

  it('runLog(filePath) reads prompt from file when path provided', async () => {
    jest.resetModules();
    const { ensureDirectories, todayLogPath } = await import('../logger.js');
    ensureDirectories();

    // Write a temp file with a prompt
    const promptFile = path.join(tempDir, 'test-prompt.txt');
    fs.writeFileSync(promptFile, 'Prompt from file\n', 'utf-8');

    const { runLog } = await import('../logger.js');
    await runLog(promptFile);

    const filePath = todayLogPath();
    expect(fs.existsSync(filePath)).toBe(true);
    const line = fs.readFileSync(filePath, 'utf-8').trim();
    const entry = JSON.parse(line);
    expect(entry.prompt).toBe('Prompt from file');
    expect(entry.timestamp).toBeTruthy();
  });

  it('runLog(filePath) throws when file does not exist', async () => {
    jest.resetModules();
    const { ensureDirectories } = await import('../logger.js');
    ensureDirectories();

    const { runLog } = await import('../logger.js');
    await expect(runLog('/nonexistent/path/prompt.txt')).rejects.toThrow();
  });
});
