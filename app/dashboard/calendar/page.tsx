/**
 * app/dashboard/calendar/page.tsx
 *
 * Redirects to /dashboard/week for backwards compatibility.
 * The calendar view has been replaced by the week view.
 */

import { redirect } from 'next/navigation';

/**
 * CalendarPage redirects to the week view.
 * Any existing bookmarks or links to /dashboard/calendar will continue to work.
 *
 * @returns Never — redirect() throws internally in Next.js.
 */
export default function CalendarPage(): never {
  redirect('/dashboard/week');
}
