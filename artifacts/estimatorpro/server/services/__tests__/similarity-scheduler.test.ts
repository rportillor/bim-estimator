/**
 * ==============================================================================
 *  SIMILARITY SCHEDULER — Test Suite
 * ==============================================================================
 */

jest.mock("../similarity-evict", () => ({
  evictByAge: jest.fn().mockResolvedValue(0),
  evictToCap: jest.fn().mockResolvedValue(0),
  evictProjectToCap: jest.fn().mockResolvedValue({ projectId: "p", total: 0, kept: 0, deleted: 0 }),
}));

import { startSimilarityEvictionScheduler } from "../similarity-scheduler";

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("similarity-scheduler.ts", () => {
  test("startSimilarityEvictionScheduler function exists", () => {
    expect(typeof startSimilarityEvictionScheduler).toBe("function");
  });

  test("function is callable without error", () => {
    expect(() => startSimilarityEvictionScheduler()).not.toThrow();
  });

  test("schedules initial timeout", () => {
    startSimilarityEvictionScheduler();
    expect(jest.getTimerCount()).toBeGreaterThanOrEqual(1);
  });
});
