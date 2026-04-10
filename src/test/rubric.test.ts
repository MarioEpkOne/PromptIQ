import { parseRubric, DEFAULT_RUBRIC_TEXT } from '../rubric.js';

describe('rubric', () => {
  it('parses default rubric into 5 criteria', () => {
    const criteria = parseRubric(DEFAULT_RUBRIC_TEXT);
    expect(criteria).toHaveLength(5);
  });

  it('extracts correct names from default rubric', () => {
    const criteria = parseRubric(DEFAULT_RUBRIC_TEXT);
    const names = criteria.map(c => c.name);
    expect(names).toContain('Clarity');
    expect(names).toContain('Context');
    expect(names).toContain('Output Format');
    expect(names).toContain('Scope');
    expect(names).toContain('Examples');
  });

  it('extracts correct weights from default rubric', () => {
    const criteria = parseRubric(DEFAULT_RUBRIC_TEXT);
    const clarity = criteria.find(c => c.name === 'Clarity');
    const examples = criteria.find(c => c.name === 'Examples');
    expect(clarity?.weight).toBe(1.0);
    expect(examples?.weight).toBe(0.5);
  });

  it('returns empty array for empty string', () => {
    const criteria = parseRubric('');
    expect(criteria).toHaveLength(0);
  });

  it('parses custom rubric with additional criteria', () => {
    const custom = `# My Rubric\n\n## Criteria\n\n### Speed (weight: 0.7)\nIs the prompt concise?\n\n### Accuracy (weight: 1.0)\nIs it factually grounded?\n`;
    const criteria = parseRubric(custom);
    expect(criteria).toHaveLength(2);
    expect(criteria[0].name).toBe('Speed');
    expect(criteria[0].weight).toBe(0.7);
    expect(criteria[1].name).toBe('Accuracy');
    expect(criteria[1].weight).toBe(1.0);
  });

  it('fallback: loadRubric returns default rubric when file missing', async () => {
    jest.resetModules();
    process.env.PROMPTIQ_HOME = '/nonexistent-path-that-does-not-exist';
    const { loadRubric } = await import('../rubric.js');
    const rubric = loadRubric();
    expect(rubric.criteria.length).toBeGreaterThan(0);
    delete process.env.PROMPTIQ_HOME;
  });
});
