/**
 * app/book/[slug]/_components/DateTimeStep.tsx
 *
 * Date and time step of the public booking page:
 *  - a month calendar of salon dates; dates outside the booking window or
 *    with nobody working are greyed out, and today is marked;
 *  - the bookable start times of the picked date, with the salon-timezone
 *    note, and loading, error ("Try again") and empty states;
 *  - Back, and Continue once a date and a time are picked.
 *
 * The calendar needs the current time, which is only known in the browser;
 * until then an empty block of the same height holds its place.
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatDateLong, formatTime12h } from './format';

// ---------------------------------------------------------------------------
// Calendar sub-component
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const DAY_LABELS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

/**
 * A simple month-grid calendar for picking a salon date.
 * Dates outside the booking window or with no bookable staff are greyed out.
 *
 * @param selected     - Currently selected YYYY-MM-DD date, or null.
 * @param onSelect     - Callback when a date is clicked.
 * @param today        - Today's date in the salon timezone.
 * @param lastDate     - Last bookable date in the salon timezone.
 * @param isSelectable - Returns false for dates that cannot be booked.
 */
function CalendarPicker({
  selected,
  onSelect,
  today,
  lastDate,
  isSelectable,
}: {
  selected: string | null;
  onSelect: (date: string) => void;
  today: string;
  lastDate: string;
  isSelectable: (dateStr: string) => boolean;
}) {
  const initial = selected ?? today;
  const [viewYear, setViewYear]   = useState(() => Number(initial.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(() => Number(initial.slice(5, 7)) - 1);

  const daysInMonth    = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
  const firstDayOfWeek = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
  const leadingEmpty   = Array.from({ length: firstDayOfWeek });

  const monthKey     = `${viewYear}-${(viewMonth + 1).toString().padStart(2, '0')}`;
  const canGoBack    = monthKey > today.slice(0, 7);
  const canGoForward = monthKey < lastDate.slice(0, 7);

  function prevMonth() {
    if (!canGoBack) return;
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  }

  function nextMonth() {
    if (!canGoForward) return;
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  }

  return (
    <div className="w-full max-w-xs mx-auto">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-5">
        <button
          type="button"
          onClick={prevMonth}
          disabled={!canGoBack}
          className="p-2 rounded-lg hover:bg-[#E8F2EC]/60 transition-colors text-[#8A8680] hover:text-[#1B4332] disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Previous month"
        >
          &#8592;
        </button>
        <span className="font-body text-sm font-semibold text-[#1A1A1A] tracking-wide">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button
          type="button"
          onClick={nextMonth}
          disabled={!canGoForward}
          className="p-2 rounded-lg hover:bg-[#E8F2EC]/60 transition-colors text-[#8A8680] hover:text-[#1B4332] disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Next month"
        >
          &#8594;
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-center text-[10px] text-[#8A8680] font-semibold py-1 tracking-wider">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {leadingEmpty.map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day        = i + 1;
          const dateStr    = `${monthKey}-${day.toString().padStart(2, '0')}`;
          const isDisabled = !isSelectable(dateStr);
          const isToday    = dateStr === today;
          const isSelected = dateStr === selected;

          return (
            <button
              key={dateStr}
              type="button"
              disabled={isDisabled}
              onClick={() => onSelect(dateStr)}
              className={[
                'aspect-square relative flex flex-col items-center justify-center text-sm rounded-full transition-colors font-body',
                isDisabled
                  ? 'text-[#8A8680]/40 cursor-not-allowed'
                  : isSelected
                    ? 'bg-[#1B4332] text-white font-semibold'
                    : isToday
                      ? 'text-[#1B4332] font-semibold hover:bg-[#E8F2EC]/60'
                      : 'text-[#1A1A1A] hover:bg-[#E8F2EC]/50',
              ].join(' ')}
            >
              {day}
              {isToday && !isSelected && (
                <span className="absolute bottom-[3px] w-1 h-1 rounded-full bg-[#1B4332]" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DateTimeStep
// ---------------------------------------------------------------------------

type DateTimeStepProps = {
  /** Today's date in the salon timezone; null until the current time is known. */
  today: string | null;
  /** Last bookable date in the salon timezone; null until the current time is known. */
  lastDate: string | null;
  /** Picked date, 'YYYY-MM-DD' in the salon timezone. */
  selectedDate: string | null;
  /** Called when a date is picked on the calendar. */
  onSelectDate: (date: string) => void;
  /** Returns false for dates that cannot be booked. */
  isDateSelectable: (dateStr: string) => boolean;
  /** Says which timezone the times are in. */
  timeZoneNote: string;
  /** True while the busy times of the picked date load. */
  loadingSlots: boolean;
  /** Message shown when the busy times could not be loaded, or ''. */
  slotsError: string;
  /** Loads the busy times of the picked date again. */
  onRetry: () => void;
  /** Bookable start times on the picked date, 'HH:MM'. */
  timeSlots: string[];
  /** Picked start time, 'HH:MM' in the salon timezone. */
  selectedTime: string | null;
  /** Called when a start time is picked. */
  onSelectTime: (time: string) => void;
  /** Goes back to the previous step; undefined when there is none (no Back button). */
  onBack?: () => void;
  /** Goes on to the details step. */
  onContinue: () => void;
};

/**
 * Lets the visitor pick a date, then a start time.
 *
 * @param props - Calendar bounds, the times on offer, the selection and the callbacks.
 */
export default function DateTimeStep({
  today,
  lastDate,
  selectedDate,
  onSelectDate,
  isDateSelectable,
  timeZoneNote,
  loadingSlots,
  slotsError,
  onRetry,
  timeSlots,
  selectedTime,
  onSelectTime,
  onBack,
  onContinue,
}: DateTimeStepProps) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-[#E5E2DB] p-6 shadow-sm">
        <h2 className="font-heading text-2xl font-bold text-[#1A1A1A] mb-6">Pick a date</h2>
        {today && lastDate ? (
          <CalendarPicker
            selected={selectedDate}
            onSelect={onSelectDate}
            today={today}
            lastDate={lastDate}
            isSelectable={isDateSelectable}
          />
        ) : (
          <div className="h-64" />
        )}
      </div>

      {selectedDate && (
        <div className="bg-white rounded-2xl border border-[#E5E2DB] p-6 shadow-sm">
          <h2 className="font-heading text-lg font-bold text-[#1A1A1A] mb-0.5">Available times</h2>
          <p className="font-body text-xs text-[#8A8680]">{formatDateLong(selectedDate)}</p>
          <p className="font-body text-xs text-[#8A8680] mb-5">{timeZoneNote}</p>

          {loadingSlots ? (
            <div className="flex items-center gap-2 text-[#8A8680]">
              <div className="w-4 h-4 border-2 border-[#E5E2DB] border-t-[#1B4332] rounded-full animate-spin" />
              <p className="font-body text-sm">Loading available times...</p>
            </div>
          ) : slotsError ? (
            <div className="space-y-2">
              <p className="font-body text-sm text-red-700">{slotsError}</p>
              <button
                type="button"
                onClick={onRetry}
                className="font-body text-sm text-[#1B4332] underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          ) : timeSlots.length === 0 ? (
            <p className="font-body text-sm text-[#8A8680]">No times available on this day. Please choose another date.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
              {timeSlots.map((slot) => {
                const isActive = selectedTime === slot;

                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => onSelectTime(slot)}
                    className={[
                      'flex items-center justify-center py-3.5 px-3 rounded-xl border transition-all',
                      isActive
                        ? 'bg-[#1B4332] text-white border-[#1B4332] shadow-sm'
                        : 'border-[#E5E2DB] text-[#1A1A1A] hover:border-[#1B4332]/40 hover:bg-[#E8F2EC]/50 hover:shadow-sm',
                    ].join(' ')}
                  >
                    <span className="font-body text-xs font-semibold">
                      {formatTime12h(slot)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="font-body text-sm text-[#8A8680] hover:text-[#1B4332] transition-colors"
          >
            &#8592; Back
          </button>
        ) : (
          // Keeps Continue on the right when there is no step to go back to.
          <span />
        )}

        <Button
          type="button"
          disabled={!selectedDate || !selectedTime}
          onClick={onContinue}
          className="bg-[#1B4332] hover:bg-[#16392A] text-white px-6 py-2.5 h-auto disabled:opacity-40 font-body"
        >
          Continue &#8594;
        </Button>
      </div>
    </div>
  );
}
