/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  BACKGROUND PROCESSOR — Test Suite
 *  Tests: singleton, public API surface, status tracking
 * ══════════════════════════════════════════════════════════════════════════════
 */

// Mock dependencies before importing the module
jest.mock('../../storage', () => ({
  storage: {
    getDocumentsByProject: jest.fn().mockResolvedValue([]),
    updateBimModel: jest.fn().mockResolvedValue({}),
    getBimModel: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../../construction-workflow-processor', () => ({
  ConstructionWorkflowProcessor: jest.fn().mockImplementation(() => ({
    processConstructionDocuments: jest.fn().mockResolvedValue({}),
  })),
}));

jest.mock('../../routes/progress', () => ({
  publishProgress: jest.fn(),
}));

import { backgroundProcessor, autoResumeProcessing } from '../background-processor';

afterEach(() => {
  backgroundProcessor.stopProcessing();
  jest.clearAllMocks();
});

describe('backgroundProcessor', () => {
  test('singleton exists', () => {
    expect(backgroundProcessor).toBeDefined();
  });

  test('has startProcessing method', () => {
    expect(typeof backgroundProcessor.startProcessing).toBe('function');
  });

  test('has stopProcessing method', () => {
    expect(typeof backgroundProcessor.stopProcessing).toBe('function');
  });

  test('has isProcessing method', () => {
    expect(typeof backgroundProcessor.isProcessing).toBe('function');
  });

  test('has getStatus method', () => {
    expect(typeof backgroundProcessor.getStatus).toBe('function');
  });

  test('initial status is null (not processing)', () => {
    expect(backgroundProcessor.getStatus()).toBeNull();
  });

  test('isProcessing returns false when idle', () => {
    expect(backgroundProcessor.isProcessing()).toBe(false);
  });

  test('stopProcessing resets state without errors', () => {
    expect(() => backgroundProcessor.stopProcessing()).not.toThrow();
    expect(backgroundProcessor.getStatus()).toBeNull();
    expect(backgroundProcessor.isProcessing()).toBe(false);
  });
});

describe('autoResumeProcessing', () => {
  test('function exists', () => {
    expect(typeof autoResumeProcessing).toBe('function');
  });
});
