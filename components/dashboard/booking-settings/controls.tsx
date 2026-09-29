/**
 * components/dashboard/booking-settings/controls.tsx
 *
 * Small presentational building blocks shared by the sections of the booking
 * settings page (app/dashboard/booking/page.tsx):
 *  - Toggle      — switch for the booking page settings (live, required fields).
 *  - SmallToggle — compact switch for the weekly availability rows.
 *  - SectionCard — the white card that holds a section's content.
 */

'use client';

/** Large toggle switch (for booking page settings). */
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-wait ${
        checked ? 'bg-[#1B4332]' : 'bg-[#E5E2DB]'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

/** Small toggle switch (compact h-5 w-9 version for availability rows). */
export function SmallToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
        checked ? 'bg-[#1B4332]' : 'bg-[#E5E2DB]/60'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

/** Wraps a settings section in a card with consistent styling. */
export function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E5E2DB]/40 overflow-hidden">
      {children}
    </div>
  );
}
