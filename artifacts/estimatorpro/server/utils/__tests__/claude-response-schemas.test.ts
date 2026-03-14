import { validateClaudeResponse, analysisResultSchema, constructionSequenceSchema, complianceResultSchema } from '../claude-response-schemas';

describe('validateClaudeResponse', () => {
  test('validates a valid analysis result', () => {
    const data = {
      overallScore: 85.5,
      riskAreas: ['Foundation depth', 'Fire rating'],
      recommendations: ['Verify depth'],
      summary: 'Good overall',
    };
    const result = validateClaudeResponse(data, analysisResultSchema, 'test');
    expect(result.overallScore).toBe(85.5);
    expect(result.riskAreas).toHaveLength(2);
  });

  test('fills defaults for missing optional fields', () => {
    const data = { overallScore: 90 };
    const result = validateClaudeResponse(data, analysisResultSchema, 'test');
    expect(result.riskAreas).toEqual([]);
    expect(result.recommendations).toEqual([]);
    expect(result.boqItems).toEqual([]);
  });

  test('does not throw on invalid data — returns raw input', () => {
    // analysisResultSchema expects overallScore as number|null
    // Passing a completely wrong shape should not throw
    const data = 'not an object';
    const result = validateClaudeResponse(data, analysisResultSchema, 'test');
    expect(result).toBe('not an object'); // returns raw input on failure
  });
});

describe('constructionSequenceSchema', () => {
  test('validates a valid sequence', () => {
    const data = {
      rationale: 'Standard CIP sequence',
      activities: [
        { activityId: 'A1010', name: 'Permits', durationDays: 60 },
        { activityId: 'A1020', name: 'Excavation', durationDays: 15, predecessors: ['A1010'] },
      ],
    };
    const result = validateClaudeResponse(data, constructionSequenceSchema, 'test');
    expect(result.activities).toHaveLength(2);
    expect(result.activities![0].activityId).toBe('A1010');
  });

  test('fills defaults for missing arrays', () => {
    const data = { rationale: 'Test' };
    const result = validateClaudeResponse(data, constructionSequenceSchema, 'test');
    expect(result.activities).toEqual([]);
    expect(result.keyAssumptions).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe('complianceResultSchema', () => {
  test('validates a compliance result', () => {
    const data = {
      code_violations: [{ element: 'wall', code: 'NBC 3.2.1', issue: 'Fire rating', severity: 'critical' }],
      summary: { total_violations: 1, critical_issues: 1, compliance_percentage: 85 },
    };
    const result = validateClaudeResponse(data, complianceResultSchema, 'test');
    expect(result.code_violations).toHaveLength(1);
    expect(result.summary?.total_violations).toBe(1);
  });
});
