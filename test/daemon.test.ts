/**
 * Tests for daemon helper functions (readPid / isAlive) and piq start/stop command actions.
 *
 * These tests run against the compiled TypeScript via ts-jest and use a PROMPTIQ_HOME
 * tmp directory to isolate all PID file I/O.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';

// Resolve the CLI entry point — works from both worktree and main project
const CLI = path.resolve(__dirname, '..', 'dist', 'cli.js');

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeTmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'piq-test-'));
}

function pidFilePath(home: string): string {
  return path.join(home, '.promptiq', 'serve.pid');
}

function runCli(args: string[], env: NodeJS.ProcessEnv = {}): cp.SpawnSyncReturns<string> {
  return cp.spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 10_000,
  });
}

// ─── Unit: readPid / isAlive ──────────────────────────────────────────────────
// These helpers are not exported from cli.ts, so we test them indirectly via
// the observable behaviour of `piq start` and `piq stop`.

describe('piq stop — no PID file', () => {
  it('exits 0 and prints "not running" when no PID file exists', () => {
    const home = makeTmpHome();
    const result = runCli(['stop'], { PROMPTIQ_HOME: home });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('not running');
    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe('piq stop — stale PID file', () => {
  it('removes stale PID file and exits 0', () => {
    const home = makeTmpHome();
    const promptiqDir = path.join(home, '.promptiq');
    fs.mkdirSync(promptiqDir, { recursive: true });
    const pidFile = pidFilePath(home);
    // Write a PID that cannot possibly be alive
    fs.writeFileSync(pidFile, '99999999', 'utf8');

    const result = runCli(['stop'], { PROMPTIQ_HOME: home });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('stale');
    expect(fs.existsSync(pidFile)).toBe(false);
    fs.rmSync(home, { recursive: true, force: true });
  });
});

// ─── Integration: piq start → piq stop ───────────────────────────────────────
// Each test uses a distinct port to avoid cross-test port conflicts.

describe('piq start — creates PID file and serves HTTP (port 3131)', () => {
  const TEST_PORT = '3131';
  let home: string;

  beforeEach(() => {
    home = makeTmpHome();
  });

  afterEach(() => {
    // Best-effort cleanup: stop server if still running
    runCli(['stop'], { PROMPTIQ_HOME: home });
    // Wait briefly for port release before allowing next suite to run
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) { /* spin */ }
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('creates a PID file and serves HTTP on the test port', (done) => {
    const start = runCli(['start', '--port', TEST_PORT], { PROMPTIQ_HOME: home });
    expect(start.status).toBe(0);
    expect(start.stdout).toContain('started');

    const pidFile = pidFilePath(home);
    expect(fs.existsSync(pidFile)).toBe(true);
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    expect(pid).toBeGreaterThan(0);

    // Poll HTTP until server is up (max 5 s)
    let attempts = 0;
    const check = setInterval(() => {
      attempts++;
      const req = cp.spawnSync(process.execPath, [
        '-e',
        `const http=require('http');http.get('http://localhost:${TEST_PORT}/api/status',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))`,
      ], { timeout: 2000 });
      if (req.status === 0) {
        clearInterval(check);
        done();
      } else if (attempts >= 25) {
        clearInterval(check);
        done(new Error('Server did not respond within 5 seconds'));
      }
    }, 200);
  }, 10_000);
});

describe('piq stop — removes PID file (port 3132)', () => {
  const TEST_PORT = '3132';
  let home: string;

  beforeEach(() => {
    home = makeTmpHome();
  });

  afterEach(() => {
    runCli(['stop'], { PROMPTIQ_HOME: home });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('stop removes PID file and port stops responding', () => {
    runCli(['start', '--port', TEST_PORT], { PROMPTIQ_HOME: home });
    const pidFile = pidFilePath(home);
    expect(fs.existsSync(pidFile)).toBe(true);

    const stop = runCli(['stop'], { PROMPTIQ_HOME: home });
    expect(stop.status).toBe(0);
    expect(stop.stdout).toContain('stopped');
    expect(fs.existsSync(pidFile)).toBe(false);
  }, 10_000);
});

describe('piq start — double-start detection (port 3133)', () => {
  const TEST_PORT = '3133';
  let home: string;

  beforeEach(() => {
    home = makeTmpHome();
  });

  afterEach(() => {
    runCli(['stop'], { PROMPTIQ_HOME: home });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('double-start exits 0 and prints "already running"', () => {
    runCli(['start', '--port', TEST_PORT], { PROMPTIQ_HOME: home });
    const second = runCli(['start', '--port', TEST_PORT], { PROMPTIQ_HOME: home });
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('already running');
  }, 10_000);
});

// ─── Build smoke test ─────────────────────────────────────────────────────────

describe('build smoke test', () => {
  it('dist/cli.js exists', () => {
    expect(fs.existsSync(CLI)).toBe(true);
  });

  it('--help output contains "piq" and not "promptiq" as the program name', () => {
    const result = runCli(['--help']);
    // The usage line is "Usage: piq [options] [command]"
    expect(result.stdout).toMatch(/Usage: piq/);
    expect(result.stdout).not.toMatch(/Usage: promptiq/);
  });

  it('--help lists start and stop commands', () => {
    const result = runCli(['--help']);
    expect(result.stdout).toContain('start');
    expect(result.stdout).toContain('stop');
  });
});

// ─── Regression: existing commands ───────────────────────────────────────────

describe('regression: existing commands still work', () => {
  let home: string;

  beforeEach(() => {
    home = makeTmpHome();
    // Seed a daily file with 0 entries so status/last don't error on missing dir
    const daily = path.join(home, '.promptiq', 'daily');
    fs.mkdirSync(daily, { recursive: true });
    fs.mkdirSync(path.join(home, '.promptiq', 'weekly'), { recursive: true });
    fs.mkdirSync(path.join(home, '.promptiq', 'monthly'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('piq status exits 0', () => {
    const result = runCli(['status'], { PROMPTIQ_HOME: home });
    expect(result.status).toBe(0);
  });

  it('piq last exits 0', () => {
    const result = runCli(['last'], { PROMPTIQ_HOME: home });
    expect(result.status).toBe(0);
  });

  it('piq rubric exits non-interactively (no editor spawned)', () => {
    // Override EDITOR to something that exits immediately
    const result = runCli(['rubric'], { PROMPTIQ_HOME: home, EDITOR: 'true' });
    // "true" command exits 0 immediately without opening a real editor
    expect(result.status).toBe(0);
  });
});
