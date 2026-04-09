/**
 * app/dashboard/week/page.tsx
 *
 * Week view page — shows all appointments for the current week in a 7-column
 * grid (desktop) or a 3-day sliding window (mobile).
 *
 * The WeekView component owns all navigation state and data fetching.
 *
 * Authentication is guaranteed by middleware.ts before this page is reached.
 * This is a Server Component — WeekView handles all client-side interactivity.
 */

import WeekView from '@/components/dashboard/WeekView';

/**
 * WeekPage renders the week calendar view.
 *
 * @returns The week page containing the WeekView component.
 */
export default function WeekPage() {
  return (
    <div className="p-6 lg:p-10">
      <div className="max-w-7xl">
        <WeekView />
      </div>
    </div>
  );
}
