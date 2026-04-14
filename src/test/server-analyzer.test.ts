import * as http from 'http';

// Mock spot-analyzer before importing server
jest.mock('../spot-analyzer.js', () => ({
  analyzePromptSpot: jest.fn().mockResolvedValue({
    overallScore: 0.75,
    criterionScores: [{ criterion: 'Clarity', score: 0.75, weight: 1.0 }],
    patterns: ['missing-context'],
    suggestions: [{ criterion: 'Clarity', issue: 'Vague', fix: 'Be specific' }],
    improvedPrompt: 'Improved prompt text',
    improvementReasons: ['Added specificity'],
  }),
}));

function makeRequest(
  server: http.Server,
  method: string,
  path: string,
  body?: string,
  contentType = 'application/json',
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      { hostname: '127.0.0.1', port: addr.port, path, method,
        headers: body !== undefined ? { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) } : {} },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe('POST /api/analyze-prompt', () => {
  let server: http.Server;

  beforeEach(done => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    jest.resetModules();
    // Import after jest.resetModules() so mock is applied
    const { startServer } = require('../server.js');
    server = startServer(0);
    server.once('listening', done);
  });

  afterEach(done => {
    delete process.env.ANTHROPIC_API_KEY;
    server.close(done);
  });

  it('400 on empty body (no JSON)', async () => {
    const r = await makeRequest(server, 'POST', '/api/analyze-prompt', '{}');
    expect(r.status).toBe(400);
  });

  it('400 when prompt is empty string', async () => {
    const r = await makeRequest(server, 'POST', '/api/analyze-prompt', JSON.stringify({ prompt: '' }));
    expect(r.status).toBe(400);
  });

  it('400 when prompt is whitespace only', async () => {
    const r = await makeRequest(server, 'POST', '/api/analyze-prompt', JSON.stringify({ prompt: '   ' }));
    expect(r.status).toBe(400);
  });

  it('400 when prompt is 301 characters', async () => {
    const long = 'a'.repeat(301);
    const r = await makeRequest(server, 'POST', '/api/analyze-prompt', JSON.stringify({ prompt: long }));
    expect(r.status).toBe(400);
    const body = JSON.parse(r.body);
    expect(body.error).toMatch(/300/);
  });

  it('200 when prompt is exactly 300 characters', async () => {
    const exactly300 = 'a'.repeat(300);
    const r = await makeRequest(server, 'POST', '/api/analyze-prompt', JSON.stringify({ prompt: exactly300 }));
    expect(r.status).toBe(200);
  });

  it('503 when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await makeRequest(server, 'POST', '/api/analyze-prompt', JSON.stringify({ prompt: 'Fix the bug' }));
    expect(r.status).toBe(503);
    const body = JSON.parse(r.body);
    expect(body.error).toContain('ANTHROPIC_API_KEY');
  });

  it('500 when analyzePromptSpot throws', async () => {
    const { analyzePromptSpot } = await import('../spot-analyzer.js');
    (analyzePromptSpot as jest.Mock).mockRejectedValueOnce(new Error('API error'));
    const r = await makeRequest(server, 'POST', '/api/analyze-prompt', JSON.stringify({ prompt: 'Fix the bug' }));
    expect(r.status).toBe(500);
  });

  it('200 and SpotAnalysis shape on valid request', async () => {
    const r = await makeRequest(server, 'POST', '/api/analyze-prompt', JSON.stringify({ prompt: 'Fix the bug' }));
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.overallScore).toBeDefined();
    expect(Array.isArray(body.criterionScores)).toBe(true);
    expect(Array.isArray(body.patterns)).toBe(true);
    expect(Array.isArray(body.suggestions)).toBe(true);
    expect(typeof body.improvedPrompt).toBe('string');
  });

  // Regression: existing GET routes must still work
  it('GET / still returns 200 with dashboard HTML', async () => {
    const r = await makeRequest(server, 'GET', '/');
    expect(r.status).toBe(200);
    expect(r.body).toContain('PromptIQ');
  });

  it('GET / dashboard HTML contains all four tab buttons', async () => {
    const r = await makeRequest(server, 'GET', '/');
    expect(r.body).toContain('switchTab(\'status\')');
    expect(r.body).toContain('switchTab(\'patterns\')');
    expect(r.body).toContain('switchTab(\'last\')');
    expect(r.body).toContain('switchTab(\'analyzer\')');
  });

  it('GET /api/status still returns 200', async () => {
    const r = await makeRequest(server, 'GET', '/api/status');
    expect(r.status).toBe(200);
  });
});

describe('GET /api/status includes todayCount', () => {
  let server: http.Server;
  let tempDir: string;

  beforeEach(done => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const os = require('os') as typeof import('os');
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptiq-status-test-'));
    process.env.PROMPTIQ_HOME = tempDir;
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    jest.resetModules();
    const { startServer } = require('../server.js');
    server = startServer(0);
    server.once('listening', done);
  });

  afterEach(done => {
    delete process.env.PROMPTIQ_HOME;
    delete process.env.ANTHROPIC_API_KEY;
    const fs = require('fs') as typeof import('fs');
    fs.rmSync(tempDir, { recursive: true, force: true });
    server.close(done);
  });

  it('returns todayCount: 0 when no prompts logged today', async () => {
    const r = await makeRequest(server, 'GET', '/api/status');
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(typeof body.todayCount).toBe('number');
    expect(body.todayCount).toBe(0);
  });

  it('returns todayCount matching the number of entries in today\'s daily file', async () => {
    // Seed daily file with 4 entries
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const today = new Date().toISOString().split('T')[0];
    const dailyDir = path.join(tempDir, '.promptiq', 'daily');
    fs.mkdirSync(dailyDir, { recursive: true });
    const entries = [
      { timestamp: '2026-04-14T10:00:00Z', prompt: 'Prompt A' },
      { timestamp: '2026-04-14T10:01:00Z', prompt: 'Prompt B' },
      { timestamp: '2026-04-14T10:02:00Z', prompt: 'Prompt C' },
      { timestamp: '2026-04-14T10:03:00Z', prompt: 'Prompt D' },
    ];
    fs.writeFileSync(
      path.join(dailyDir, today + '.jsonl'),
      entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    );
    const r = await makeRequest(server, 'GET', '/api/status');
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.todayCount).toBe(4);
  });
});

describe('POST /api/run-analysis', () => {
  let server: http.Server;
  let tempDir: string;

  beforeEach(done => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const os = require('os') as typeof import('os');
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptiq-run-analysis-test-'));
    process.env.PROMPTIQ_HOME = tempDir;
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    jest.resetModules();
    // Mock analyzeToday to avoid real API calls
    jest.mock('../analyzer.js', () => ({
      analyzeToday: jest.fn().mockResolvedValue({
        date: new Date().toISOString().split('T')[0],
        promptCount: 3,
        avgScore: 0.72,
        scores: [],
        patterns: [],
        suggestions: [],
        summary: 'Test summary.',
        mainTip: { text: 'Test tip.', why: 'Test why.' },
      }),
      synthesizeWeek: jest.fn().mockResolvedValue('Test week summary.'),
    }));
    const { startServer } = require('../server.js');
    server = startServer(0);
    server.once('listening', done);
  });

  afterEach(done => {
    delete process.env.PROMPTIQ_HOME;
    delete process.env.ANTHROPIC_API_KEY;
    jest.unmock('../analyzer.js');
    const fs = require('fs') as typeof import('fs');
    fs.rmSync(tempDir, { recursive: true, force: true });
    server.close(done);
  });

  it('503 when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await makeRequest(server, 'POST', '/api/run-analysis', '');
    expect(r.status).toBe(503);
    const body = JSON.parse(r.body);
    expect(body.error).toBe('no_api_key');
  });

  it('400 when no prompts logged today', async () => {
    // No daily file seeded — empty directory
    const r = await makeRequest(server, 'POST', '/api/run-analysis', '');
    expect(r.status).toBe(400);
    const body = JSON.parse(r.body);
    expect(body.error).toBe('no_prompts');
  });

  it('200 + too_few_prompts when today has < 3 task prompts (after classification)', async () => {
    // Seed with 2 prompts (both task prompts — neither is a control prompt)
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const today = new Date().toISOString().split('T')[0];
    const dailyDir = path.join(tempDir, '.promptiq', 'daily');
    fs.mkdirSync(dailyDir, { recursive: true });
    const entries = [
      { timestamp: '2026-04-14T10:00:00Z', prompt: 'Implement a retry mechanism for the HTTP client' },
      { timestamp: '2026-04-14T10:01:00Z', prompt: 'Refactor the database layer to use repositories' },
    ];
    fs.writeFileSync(
      path.join(dailyDir, today + '.jsonl'),
      entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    );
    const r = await makeRequest(server, 'POST', '/api/run-analysis', '');
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.error).toBe('too_few_prompts');
    expect(typeof body.count).toBe('number');
  });

  it('200 + avgScore in response on success path (\u22653 task prompts)', async () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const today = new Date().toISOString().split('T')[0];
    const dailyDir = path.join(tempDir, '.promptiq', 'daily');
    fs.mkdirSync(dailyDir, { recursive: true });
    const entries = [
      { timestamp: '2026-04-14T10:00:00Z', prompt: 'Implement a retry mechanism for the HTTP client' },
      { timestamp: '2026-04-14T10:01:00Z', prompt: 'Refactor the database layer to use repositories' },
      { timestamp: '2026-04-14T10:02:00Z', prompt: 'Add unit tests for the auth module edge cases' },
    ];
    fs.writeFileSync(
      path.join(dailyDir, today + '.jsonl'),
      entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    );
    const r = await makeRequest(server, 'POST', '/api/run-analysis', '');
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(typeof body.avgScore).toBe('number');
    expect(typeof body.promptCount).toBe('number');
    expect(typeof body.caughtUp).toBe('number');
    // Verify weekly file was written
    const weeklyDir = path.join(tempDir, '.promptiq', 'weekly');
    const weeklyFiles = fs.readdirSync(weeklyDir);
    expect(weeklyFiles.length).toBeGreaterThan(0);
  });

  it('409 when analysis already in progress', async () => {
    // We cannot directly set analysisInProgress from outside the module, so we simulate
    // by sending two concurrent requests. The second should get 409 while the first is in flight.
    // Use a 500ms delay mock so the first request is still in-flight when the second arrives.
    const { analyzeToday } = require('../analyzer.js') as typeof import('../analyzer.js');
    (analyzeToday as jest.Mock).mockImplementationOnce(
      () => new Promise(resolve => setTimeout(() => resolve({
        date: new Date().toISOString().split('T')[0],
        promptCount: 3,
        avgScore: 0.72,
        scores: [],
        patterns: [],
        suggestions: [],
        summary: 'Test summary.',
        mainTip: { text: 'Test tip.', why: 'Test why.' },
      }), 500))
    );

    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const today = new Date().toISOString().split('T')[0];
    const dailyDir = path.join(tempDir, '.promptiq', 'daily');
    fs.mkdirSync(dailyDir, { recursive: true });
    const entries = [
      { timestamp: '2026-04-14T10:00:00Z', prompt: 'Implement retry logic for the HTTP client' },
      { timestamp: '2026-04-14T10:01:00Z', prompt: 'Refactor the database connection pool' },
      { timestamp: '2026-04-14T10:02:00Z', prompt: 'Add unit tests for the auth module' },
    ];
    fs.writeFileSync(
      path.join(dailyDir, today + '.jsonl'),
      entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    );

    // Fire first request (will complete after 500ms delay in analyzeToday mock)
    const firstRequest = makeRequest(server, 'POST', '/api/run-analysis', '');

    // Small delay to let the first request start and set the flag
    await new Promise(resolve => setTimeout(resolve, 50));

    // Second request should be 409 while first is still in-flight
    const r2 = await makeRequest(server, 'POST', '/api/run-analysis', '');
    expect(r2.status).toBe(409);
    const body = JSON.parse(r2.body);
    expect(body.error).toBe('already_running');

    // Wait for first request to complete before cleanup
    await firstRequest;
  }, 10000);
});
