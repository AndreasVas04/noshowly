/**
 * components/dashboard/appointment-modal/WarningDialog.tsx
 *
 * Soft-warning confirmation dialog, overlaid inside the appointment modal
 * when the appointment has soft warnings (past date, far future, outside
 * business hours). "Go back" returns to the form; "Yes, save" saves anyway.
 */

'use client';

import { Button } from '@/components/ui/button';

/** Props accepted by WarningDialog. */
interface WarningDialogProps {
  /** The warnings, one per line ('\n'-separated). */
  message: string;
  /** Closes the overlay without saving. */
  onGoBack: () => void;
  /** Saves despite the warnings. */
  onConfirm: () => void;
}

/**
 * WarningDialog renders the "Check before saving" overlay.
 *
 * @param props.message   - The warnings, one per line.
 * @param props.onGoBack  - Closes the overlay without saving.
 * @param props.onConfirm - Saves despite the warnings.
 */
export default function WarningDialog({ message, onGoBack, onConfirm }: WarningDialogProps) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 rounded-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Appointment warning"
    >
      <div className="mx-4 bg-white rounded-xl shadow-xl p-6 max-w-sm w-full border border-[#C8C8C8]/40">
        <p className="font-heading text-base font-semibold text-[#1A1A1A] mb-3">
          Check before saving
        </p>
        {message.split('\n').map((line, i) => (
          <p key={i} className="text-sm text-[#2D2D2D] mb-2">{line}</p>
        ))}
        <div className="flex gap-2 justify-end mt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onGoBack}
            className="border-[#C8C8C8] text-[#1A1A1A] hover:border-[#1A1A1A]/40 text-sm"
          >
            Go back
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            className="bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm"
          >
            Yes, save
          </Button>
        </div>
      </div>
    </div>
  );
}
