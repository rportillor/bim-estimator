/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  UTILITY MODULES — Grid Extractor, Progress Bus, Watchdog, Shared Types
 *  (deterministic-fixes.ts and shared-bim-types.ts blocks removed —
 *   both services deleted in v14.22 dead-code pass)
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ─── GRID EXTRACTOR ─────────────────────────────────────────────────────────

import { buildNonUniformGridsFromAnalysis, computePrimaryAngles } from '../grid-extractor';

describe('grid-extractor.ts', () => {
  test('buildNonUniformGridsFromAnalysis returns null for null input', () => {
    expect(buildNonUniformGridsFromAnalysis(null)).toBeNull();
  });

  test('buildNonUniformGridsFromAnalysis returns null for empty analysis', () => {
    expect(buildNonUniformGridsFromAnalysis({})).toBeNull();
  });

  test('buildNonUniformGridsFromAnalysis extracts grids from valid data', () => {
    const analysis = {
      grid_system: {
        x: [{ name: 'A', pos: 0 }, { name: 'B', pos: 6 }],
        y: [{ name: '1', pos: 0 }, { name: '2', pos: 8 }],
      },
    };
    const result = buildNonUniformGridsFromAnalysis(analysis);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.x || result.y).toBeDefined();
    }
  });

  test('computePrimaryAngles returns default angles for null footprint', () => {
    const result = computePrimaryAngles(null);
    expect(result).toEqual({ buildingDeg: 0, siteDeg: 0 });
  });

  test('computePrimaryAngles computes for rectangular footprint', () => {
    const footprint = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 15 },
      { x: 0, y: 15 },
    ];
    const result = computePrimaryAngles(footprint);
    expect(result).toBeDefined();
  });
});

// ─── PROGRESS BUS ───────────────────────────────────────────────────────────

import { getBus, publish } from '../progress-bus';

describe('progress-bus.ts', () => {
  test('getBus returns EventEmitter for model ID', () => {
    const bus = getBus('model-test-001');
    expect(bus).toBeDefined();
    expect(typeof bus.on).toBe('function');
    expect(typeof bus.emit).toBe('function');
  });

  test('same model ID returns same bus', () => {
    const bus1 = getBus('model-bus-same');
    const bus2 = getBus('model-bus-same');
    expect(bus1).toBe(bus2);
  });

  test('different model IDs return different buses', () => {
    const bus1 = getBus('model-a');
    const bus2 = getBus('model-b');
    expect(bus1).not.toBe(bus2);
  });

  test('publish emits tick event', (done) => {
    const bus = getBus('model-publish-test');
    bus.on('tick', (payload: any) => {
      expect(payload.progress).toBe(0.5);
      done();
    });
    publish('model-publish-test', { progress: 0.5 });
  });
});

// ─── GENERATION WATCHDOG ────────────────────────────────────────────────────

import { startWatchdog, stopWatchdog, heartbeat } from '../generation-watchdog';

describe('generation-watchdog.ts', () => {
  afterEach(() => {
    stopWatchdog('test-wd');
  });

  test('startWatchdog creates a watchdog', () => {
    const onFire = jest.fn();
    startWatchdog('test-wd', 10000, onFire);
    expect(onFire).not.toHaveBeenCalled();
    stopWatchdog('test-wd');
  });

  test('stopWatchdog clears the watchdog', () => {
    const onFire = jest.fn();
    startWatchdog('test-wd', 10000, onFire);
    stopWatchdog('test-wd');
    expect(onFire).not.toHaveBeenCalled();
  });

  test('heartbeat updates last beat time', () => {
    const onFire = jest.fn();
    startWatchdog('test-wd', 10000, onFire);
    heartbeat('test-wd');
    expect(onFire).not.toHaveBeenCalled();
    stopWatchdog('test-wd');
  });
});

// ─── SHARED TYPES ───────────────────────────────────────────────────────────

import * as sharedTypes from '../shared-types';

describe('shared-types.ts', () => {
  test('exports type definitions', () => {
    expect(sharedTypes).toBeDefined();
  });

  test('has expected exports', () => {
    const keys = Object.keys(sharedTypes);
    expect(keys.length).toBeGreaterThan(0);
  });
});
