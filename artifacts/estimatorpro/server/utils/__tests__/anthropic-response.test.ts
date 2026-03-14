import { parseFirstJsonObject, parseFirstJsonArray } from '../anthropic-response';

describe('parseFirstJsonObject', () => {
  test('parses clean JSON', () => {
    const result = parseFirstJsonObject('{"name": "test", "value": 42}');
    expect(result).toEqual({ name: 'test', value: 42 });
  });

  test('extracts JSON from surrounding prose', () => {
    const text = 'Here is the analysis:\n{"score": 85, "items": []}\nEnd of analysis.';
    const result = parseFirstJsonObject(text);
    expect(result).toEqual({ score: 85, items: [] });
  });

  test('handles markdown-fenced JSON', () => {
    const text = '```json\n{"key": "value"}\n```';
    const result = parseFirstJsonObject(text);
    expect(result).toEqual({ key: 'value' });
  });

  test('handles nested braces in strings', () => {
    const text = '{"description": "Wall type {EW1} exterior", "count": 5}';
    const result = parseFirstJsonObject(text);
    expect(result).toEqual({ description: 'Wall type {EW1} exterior', count: 5 });
  });

  test('handles deeply nested objects', () => {
    const text = '{"a": {"b": {"c": {"d": 1}}}}';
    const result = parseFirstJsonObject(text);
    expect(result).toEqual({ a: { b: { c: { d: 1 } } } });
  });

  test('does NOT greedily capture two separate JSON objects', () => {
    // The greedy regex \{[\s\S]*\} would capture everything from first { to last }
    // including prose in between. The bracket counter should only capture the first object.
    const text = '{"first": true}\nSome prose here\n{"second": true}';
    const result = parseFirstJsonObject(text);
    expect(result).toEqual({ first: true });
  });

  test('handles trailing commas', () => {
    const text = '{"items": ["a", "b",], "count": 2,}';
    const result = parseFirstJsonObject(text);
    expect(result).toEqual({ items: ['a', 'b'], count: 2 });
  });

  test('handles prefill re-attachment (starts with brace)', () => {
    // Simulates the prefill pattern: '{' + response_without_opening_brace
    const claudeResponse = '"storeys": [{"name": "Ground"}], "height": 12}';
    const withPrefill = '{' + claudeResponse;
    const result = parseFirstJsonObject(withPrefill);
    expect(result).toEqual({ storeys: [{ name: 'Ground' }], height: 12 });
  });

  test('returns error sentinel for completely unparseable text', () => {
    const result = parseFirstJsonObject('This is just plain text with no JSON');
    expect(result).toHaveProperty('error');
  });

  test('handles empty object', () => {
    const result = parseFirstJsonObject('{}');
    expect(result).toEqual({});
  });

  test('handles escaped quotes in strings', () => {
    const text = '{"name": "3\\"-0\\" x 7\\"-0\\"", "type": "door"}';
    const result = parseFirstJsonObject(text);
    expect(result.type).toBe('door');
  });

  test('handles arrays inside objects', () => {
    const text = '{"materials": [{"item": "Concrete", "qty": 45}, {"item": "Steel", "qty": 12}]}';
    const result = parseFirstJsonObject(text);
    expect(result.materials).toHaveLength(2);
    expect(result.materials[0].item).toBe('Concrete');
  });
});

describe('parseFirstJsonArray', () => {
  test('parses clean JSON array', () => {
    const result = parseFirstJsonArray('[{"id": 1}, {"id": 2}]');
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test('extracts array from surrounding prose', () => {
    const text = 'Here are the floors:\n[{"name": "Ground"}, {"name": "First"}]\nDone.';
    const result = parseFirstJsonArray(text);
    expect(result).toEqual([{ name: 'Ground' }, { name: 'First' }]);
  });

  test('does NOT truncate at first ] inside nested structure', () => {
    // The lazy regex \[[\s\S]*?\] would stop at the first ]
    // This tests that bracket counting handles nested arrays
    const text = '[{"tags": ["a", "b"]}, {"tags": ["c"]}]';
    const result = parseFirstJsonArray(text);
    expect(result).toHaveLength(2);
    expect(result[0].tags).toEqual(['a', 'b']);
    expect(result[1].tags).toEqual(['c']);
  });

  test('handles prefill re-attachment (starts with bracket)', () => {
    const claudeResponse = '{"name": "Ground"}, {"name": "First"}]';
    const withPrefill = '[' + claudeResponse;
    const result = parseFirstJsonArray(withPrefill);
    expect(result).toHaveLength(2);
  });

  test('returns empty array for unparseable text', () => {
    const result = parseFirstJsonArray('No JSON here');
    expect(result).toEqual([]);
  });

  test('handles empty array', () => {
    const result = parseFirstJsonArray('[]');
    expect(result).toEqual([]);
  });

  test('handles markdown-fenced array', () => {
    const text = '```json\n[1, 2, 3]\n```';
    const result = parseFirstJsonArray(text);
    expect(result).toEqual([1, 2, 3]);
  });
});
