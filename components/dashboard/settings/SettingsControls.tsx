/**
 * components/dashboard/settings/SettingsControls.tsx
 *
 * Small controls shared by the Settings page sections: the label above a form
 * field and the save-state indicator in the top-right of a section header.
 */

'use client';

import { Label } from '@/components/ui/label';
import type { SaveStatus } from '@/components/dashboard/settings/settings-helpers';

/** Label above a form field. */
export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <Label htmlFor={htmlFor} className="text-sm font-medium text-[#1A1A1A]">
      {children}
    </Label>
  );
}

/**
 * Subtle save-state indicator shown in the top-right of each section header.
 * Renders nothing when idle, "Saving…" while in-flight, "Saved ✓" briefly after.
 */
export function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === 'idle')   return null;
  if (status === 'saving') return <span className="text-xs text-[#6F6B65]">Saving…</span>;
  if (status === 'saved')  return <span className="text-xs text-emerald-600 font-medium">Saved ✓</span>;
  return null; // error shown inline in the section
}
