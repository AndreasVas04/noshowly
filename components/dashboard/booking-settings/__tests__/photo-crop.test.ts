/**
 * components/dashboard/booking-settings/__tests__/photo-crop.test.ts
 *
 * Unit tests for the staff photo crop geometry in
 * components/dashboard/booking-settings/photo-crop.ts: the smallest zoom that
 * still covers the crop circle, keeping the image over the circle while it is
 * moved, and the distance between two touch points.
 */

import { describe, expect, it } from 'vitest';
import {
  CIRCLE_RADIUS,
  clampCropPos,
  getCropMinScale,
  getTouchDist,
} from '@/components/dashboard/booking-settings/photo-crop';

describe('getCropMinScale', () => {
  it('scales the shorter side to the diameter of the circle', () => {
    expect(CIRCLE_RADIUS * 2).toBe(280);
    expect(getCropMinScale(560, 280)).toBe(1);
    expect(getCropMinScale(1000, 2000)).toBe(0.28);
  });

  it('enlarges an image smaller than the circle', () => {
    expect(getCropMinScale(140, 140)).toBe(2);
  });
});

describe('clampCropPos', () => {
  it('leaves an offset that keeps the circle covered unchanged', () => {
    // 1000 × 1000 at half size is 500 px wide: up to 250 − 140 = 110 px either way.
    expect(clampCropPos(50, -50, 0.5, 1000, 1000)).toEqual({ x: 50, y: -50 });
  });

  it('limits the offset on each axis to where the image edge meets the circle', () => {
    expect(clampCropPos(500, -500, 0.5, 1000, 1000)).toEqual({ x: 110, y: -110 });
    // 1000 × 560 at half size is 500 × 280: it can move sideways only.
    expect(clampCropPos(-200, 50, 0.5, 1000, 560)).toEqual({ x: -110, y: 0 });
  });

  it('centres an image that is no larger than the circle', () => {
    expect(clampCropPos(30, 30, 1, 100, 100)).toEqual({ x: 0, y: 0 });
  });
});

describe('getTouchDist', () => {
  it('returns the distance between the first two touches', () => {
    const touches = [
      { clientX: 10, clientY: 20 },
      { clientX: 13, clientY: 24 },
    ] as unknown as React.TouchList;
    expect(getTouchDist(touches)).toBe(5);
  });
});
