/**
 * app/book/[slug]/_components/BookingSidebar.tsx
 *
 * Desktop sidebar of the public booking page (lg and up):
 *  - the business name and the optional welcome message;
 *  - a live summary of the booking once anything is chosen: service with
 *    duration and price, staff, date and time;
 *  - the steps, each marked complete, active or upcoming. The Staff step is
 *    only listed when there is a choice to make, and the Service step only
 *    when the salon has services.
 *
 * Smaller screens show the business name in a hero above the steps instead
 * (in BookingFlow).
 */

'use client';

import { formatDateLong, formatTime12h } from './format';
import type { BookingSummary, Step } from './types';

type BookingSidebarProps = {
  /** Name shown to visitors: the custom title, or the salon name. */
  businessName: string;
  /** Optional welcome message shown below the title. */
  customIntro: string | null;
  /** What the visitor has chosen so far. */
  summary: BookingSummary;
  /** The current step. */
  step: Step;
  /** True when the staff step has a real choice to make. */
  hasStaffChoice: boolean;
  /** True when the salon has services, so there is a service step. */
  hasServices: boolean;
};

/**
 * Renders the desktop sidebar with the live booking summary and the step list.
 *
 * @param props - Title and intro, the summary, and which steps there are and which is current.
 */
export default function BookingSidebar({
  businessName,
  customIntro,
  summary,
  step,
  hasStaffChoice,
  hasServices,
}: BookingSidebarProps) {
  const {
    selectedService,
    selectedServiceDuration,
    selectedServicePrice,
    staffLabel,
    selectedDate,
    selectedTime,
  } = summary;

  // Sidebar step list — only show the Staff step when there is a choice to make.
  const FLOW_STEPS: { id: Step; label: string }[] = [
    ...(hasStaffChoice ? [{ id: 'staff' as Step, label: 'Staff member' }] : []),
    ...(hasServices ? [{ id: 'service' as Step, label: 'Service' }] : []),
    { id: 'datetime' as Step, label: 'Date & time' },
    { id: 'details' as Step, label: 'Your details' },
  ];

  const stepOrder: Step[] = ['staff', 'service', 'datetime', 'details', 'success'];
  const currentStepIdx = stepOrder.indexOf(step);

  /** Returns display status of a sidebar step. */
  function stepStatus(s: Step): 'active' | 'complete' | 'upcoming' {
    const idx = stepOrder.indexOf(s);
    if (idx === currentStepIdx) return 'active';
    if (idx < currentStepIdx) return 'complete';
    return 'upcoming';
  }

  /** Booking summary lines for sidebar. */
  const hasSummary =
    selectedService !== null ||
    staffLabel !== null ||
    selectedDate !== null ||
    selectedTime !== null;

  return (
    <aside className="hidden lg:flex flex-col w-[280px] shrink-0 sticky top-0 self-start h-screen overflow-y-auto" style={{ background: 'linear-gradient(180deg, #1B4332 0%, #122B20 100%)' }}>
      <div className="flex flex-col h-full p-7 gap-0">

        {/* Business name */}
        <h1 className="font-heading text-white text-[16px] font-bold leading-snug mt-1">
          {businessName}
        </h1>
        {customIntro && (
          <p className="mt-3 font-body text-[12px] text-white/55 leading-relaxed tracking-wide">
            {customIntro}
          </p>
        )}

        {/* Live booking summary */}
        {hasSummary && (
          <div className="mt-6 pt-5 border-t border-white/10 space-y-2">
            <p className="font-body text-[10px] text-white/30 uppercase tracking-widest">Your booking</p>
            {selectedService && (
              <div>
                <p className="font-body text-white text-sm font-semibold leading-snug">
                  {selectedService.name}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {selectedServiceDuration && (
                    <span className="font-body text-white/40 text-[11px]">
                      {selectedServiceDuration} min
                    </span>
                  )}
                  {selectedServicePrice && (
                    <span className="font-body text-white/60 text-[11px] font-medium">
                      {selectedServicePrice}
                    </span>
                  )}
                </div>
              </div>
            )}
            {staffLabel && (
              <p className="font-body text-white/50 text-[11px]">{staffLabel}</p>
            )}
            {selectedDate && (
              <p className="font-body text-white/60 text-[11px]">{formatDateLong(selectedDate)}</p>
            )}
            {selectedTime && (
              <p className="font-body text-white text-sm font-semibold">{formatTime12h(selectedTime)}</p>
            )}
          </div>
        )}

        {/* Vertical step list — pushed to bottom */}
        <nav className="mt-auto pt-8">
          <ol className="space-y-3.5">
            {FLOW_STEPS.map(({ id, label }) => {
              const status = stepStatus(id);
              return (
                <li key={id} className="flex items-center gap-3">
                  {/* Step circle: complete = white filled + dark ✓, active = white + dark border, upcoming = empty grey ring */}
                  <div
                    className={[
                      'w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 transition-all',
                      status === 'active'   ? 'bg-transparent border-2 border-white'        :
                      status === 'complete' ? 'bg-white text-[#1B4332] text-[10px] font-bold' :
                                             'border-2 border-white/20 bg-transparent',
                    ].join(' ')}
                  >
                    {status === 'complete' ? '✓' : ''}
                  </div>
                  <span
                    className={[
                      'font-body text-[13px] transition-all',
                      status === 'active'   ? 'text-white font-medium'  :
                      status === 'complete' ? 'text-white/40'           :
                                             'text-white/20',
                    ].join(' ')}
                  >
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    </aside>
  );
}
