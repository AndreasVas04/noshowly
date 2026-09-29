/**
 * app/book/[slug]/_components/__tests__/clock.test.ts
 *
 * Unit tests for the booking page's minute clock in
 * app/book/[slug]/_components/clock.ts, with fake timers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  currentMinute,
  noMinuteOnServer,
  subscribeToMinutes,
} from '@/app/book/[slug]/_components/clock';

describe('minute clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T07:30:40.500Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports the start of the current minute', () => {
    expect(currentMinute()).toBe(Date.parse('2026-04-15T07:30:00Z'));
  });

  it('calls back at the start of every minute', () => {
    const onMinute = vi.fn();
    subscribeToMinutes(onMinute);

    vi.advanceTimersByTime(19_499);
    expect(onMinute).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onMinute).toHaveBeenCalledTimes(1);
    expect(currentMinute()).toBe(Date.parse('2026-04-15T07:31:00Z'));

    vi.advanceTimersByTime(60_000);
    expect(onMinute).toHaveBeenCalledTimes(2);
    expect(currentMinute()).toBe(Date.parse('2026-04-15T07:32:00Z'));
  });

  it('stops calling back once unsubscribed', () => {
    const onMinute = vi.fn();
    const unsubscribe = subscribeToMinutes(onMinute);

    vi.advanceTimersByTime(19_500);
    expect(onMinute).toHaveBeenCalledTimes(1);

    unsubscribe();
    vi.advanceTimersByTime(5 * 60_000);
    expect(onMinute).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('has no current minute on the server', () => {
    expect(noMinuteOnServer()).toBeNull();
  });
});
