/**
 * app/book/[slug]/_components/clock.ts
 *
 * The current minute as an external store, read by BookingFlow through
 * useSyncExternalStore. The salon's "today", the booking window and the
 * minimum notice all depend on it, so it moves on at the start of every
 * minute while the page is open. There is no current time during the server
 * render (and hydration), so that render never depends on the clock.
 *
 * No imports from React or Next.js, so this is safe to use anywhere.
 */

const MINUTE_MS = 60_000;

/**
 * Calls `onMinute` at the start of every minute until unsubscribed.
 *
 * @param onMinute - Called when a new minute starts.
 * @returns        Unsubscribe function.
 */
export function subscribeToMinutes(onMinute: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(() => {
      onMinute();
      schedule();
    }, MINUTE_MS - (Date.now() % MINUTE_MS));
  };
  schedule();
  return () => clearTimeout(timer);
}

/** Start of the current minute, in milliseconds since the epoch. */
export function currentMinute(): number {
  return Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
}

/** No current time during the server render (and hydration), so it never depends on the clock. */
export function noMinuteOnServer(): number | null {
  return null;
}
