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
