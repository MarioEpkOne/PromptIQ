import * as fs from 'fs';
import * as path from 'path';
import { promptiqDir } from './logger.js';
import type { Rubric, RubricCriterion } from './types.js';

const RUBRIC_FILENAME = 'rubric.md';

// Built-in default rubric — used as fallback if rubric.md is missing or empty
export const DEFAULT_RUBRIC_TEXT = `# PromptIQ Rubric

Criteria used to evaluate prompt quality. Edit freely — add, remove, or reweight.

## Criteria

### Clarity (weight: 1.0)
Is the intent unambiguous? Could the prompt be interpreted multiple ways?

### Context (weight: 1.0)
Does the prompt include enough background for the model to understand the situation?

### Output Format (weight: 0.8)
Does the prompt specify what format or structure the response should take?

### Scope (weight: 0.8)
Is the prompt focused? Not too broad ("explain everything about X") or over-specified?

### Examples (weight: 0.5)
Where helpful, does the prompt include examples to clarify the request?
`;

/**
 * Returns the path to the user's rubric file.
 */
export function rubricPath(): string {
  return path.join(promptiqDir(), RUBRIC_FILENAME);
}

/**
 * Copies the default rubric from the assets directory to ~/.promptiq/rubric.md.
 * Called on first run when rubric.md does not exist.
 */
export function copyDefaultRubric(assetsDir: string): void {
  const dest = rubricPath();
  if (!fs.existsSync(dest)) {
    const src = path.join(assetsDir, 'default-rubric.md');
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    } else {
      // Fall back to embedded default
      fs.writeFileSync(dest, DEFAULT_RUBRIC_TEXT, 'utf-8');
    }
  }
}

/**
 * Parses a rubric markdown file into structured criteria.
 *
 * Expects H3 headers in the form:
 *   ### Criterion Name (weight: 0.8)
 * followed by description text.
 */
export function parseRubric(text: string): RubricCriterion[] {
  const criteria: RubricCriterion[] = [];
  // Match ### Name (weight: N.N) blocks
  const headerRegex = /^###\s+(.+?)\s+\(weight:\s*([\d.]+)\)/gm;
  let match: RegExpExecArray | null;

  // Split sections by H3
  const sections = text.split(/^###\s+/m).slice(1); // drop preamble

  for (const section of sections) {
    const firstLine = section.split('\n')[0];
    const weightMatch = firstLine.match(/^(.+?)\s+\(weight:\s*([\d.]+)\)/);
    if (!weightMatch) continue;

    const name = weightMatch[1].trim();
    const weight = parseFloat(weightMatch[2]);
    const description = section
      .split('\n')
      .slice(1)
      .join('\n')
      .trim();

    criteria.push({ name, weight, description });
  }

  // Reset headerRegex lastIndex (safety)
  headerRegex.lastIndex = 0;

  return criteria;
}

/**
 * Loads the rubric from ~/.promptiq/rubric.md.
 * Falls back to built-in default if file is missing or empty, printing a warning.
 */
export function loadRubric(): Rubric {
  const filePath = rubricPath();
  let rawText = '';

  if (fs.existsSync(filePath)) {
    rawText = fs.readFileSync(filePath, 'utf-8').trim();
  }

  if (!rawText) {
    console.warn('Warning: rubric.md is missing or empty — using built-in default rubric.');
    rawText = DEFAULT_RUBRIC_TEXT;
  }

  const criteria = parseRubric(rawText);

  return { criteria, rawText };
}
