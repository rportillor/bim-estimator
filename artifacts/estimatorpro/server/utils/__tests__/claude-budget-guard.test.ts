import { estimateInputTokens } from '../claude-budget-guard';

describe('estimateInputTokens', () => {
  test('estimates tokens from string system prompt', () => {
    const params = {
      system: 'You are a construction analyst.',
      messages: [{ role: 'user', content: 'Analyze this document.' }],
    };
    const tokens = estimateInputTokens(params);
    // ~30 chars system + ~25 chars user = ~55 chars / 4 = ~14 tokens
    expect(tokens).toBeGreaterThan(10);
    expect(tokens).toBeLessThan(30);
  });

  test('estimates tokens from array system prompt', () => {
    const params = {
      system: [{ type: 'text', text: 'System prompt with more detail about the task.' }],
      messages: [{ role: 'user', content: 'Short message.' }],
    };
    const tokens = estimateInputTokens(params);
    expect(tokens).toBeGreaterThan(10);
  });

  test('accounts for image blocks', () => {
    const params = {
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', data: 'abc' } },
          { type: 'text', text: 'Describe this.' },
        ],
      }],
    };
    const tokens = estimateInputTokens(params);
    // Image adds ~1000 tokens
    expect(tokens).toBeGreaterThan(900);
  });

  test('accounts for document blocks', () => {
    const params = {
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', data: 'abc' } },
          { type: 'text', text: 'Analyze this PDF.' },
        ],
      }],
    };
    const tokens = estimateInputTokens(params);
    // Document adds ~2000 tokens
    expect(tokens).toBeGreaterThan(1900);
  });

  test('handles empty params', () => {
    const tokens = estimateInputTokens({});
    expect(tokens).toBe(0);
  });

  test('handles multiple messages', () => {
    const params = {
      messages: [
        { role: 'user', content: 'First message with some content.' },
        { role: 'assistant', content: '{' },
      ],
    };
    const tokens = estimateInputTokens(params);
    expect(tokens).toBeGreaterThan(5);
  });
});
