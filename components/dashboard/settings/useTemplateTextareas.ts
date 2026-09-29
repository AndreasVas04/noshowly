/**
 * components/dashboard/settings/useTemplateTextareas.ts
 *
 * The email template textareas of the Message templates section: their refs,
 * auto-resizing them to their content whenever a template value changes, and
 * inserting a template variable at the cursor (the variable chips under the
 * email body).
 *
 * The page calls this hook, after useSettingsData(), rather than the section:
 * the resize effect then runs when a template value changes, not when the
 * section mounts.
 */

'use client';

import { useEffect, useRef } from 'react';
import { insertVariable } from '@/components/dashboard/settings/settings-helpers';
import type { TemplateFields } from '@/components/dashboard/settings/useSettingsData';

/** The textarea refs and the variable insertion helper. */
export type TemplateTextareas = {
  emailBodyTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  emailSubjectTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  emailGreetingTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  emailClosingTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  emailFooterTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  insertAtCursor: (
    elRef: { current: HTMLTextAreaElement | HTMLInputElement | null },
    variable: string,
    current: string,
    setter: (fn: (prev: string) => string) => void,
  ) => string;
};

/** The template values the textareas are resized for. */
type TemplateValues = Pick<
  TemplateFields,
  'emailSubject' | 'emailGreeting' | 'emailBody' | 'emailClosing' | 'emailFooter'
>;

/**
 * Creates the template textarea refs and keeps the textareas sized to their content.
 *
 * @param values - The current template values; a change resizes the textareas.
 * @returns      The textarea refs and insertAtCursor().
 */
export function useTemplateTextareas({
  emailSubject,
  emailGreeting,
  emailBody,
  emailClosing,
  emailFooter,
}: TemplateValues): TemplateTextareas {
  // Textarea refs — emailBodyTextareaRef also used for cursor-position variable insertion.
  const emailBodyTextareaRef    = useRef<HTMLTextAreaElement>(null);
  const emailSubjectTextareaRef  = useRef<HTMLTextAreaElement>(null);
  const emailGreetingTextareaRef = useRef<HTMLTextAreaElement>(null);
  const emailClosingTextareaRef  = useRef<HTMLTextAreaElement>(null);
  const emailFooterTextareaRef   = useRef<HTMLTextAreaElement>(null);

  /**
   * Auto-resizes all email template textareas when their content changes
   * (e.g. initial data load or user edits). Runs after paint so scrollHeight is accurate.
   */
  useEffect(() => {
    for (const ref of [
      emailSubjectTextareaRef,
      emailGreetingTextareaRef,
      emailBodyTextareaRef,
      emailClosingTextareaRef,
      emailFooterTextareaRef,
    ]) {
      const el = ref.current;
      if (!el) continue;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [emailSubject, emailGreeting, emailBody, emailClosing, emailFooter]);

  // -------------------------------------------------------------------------
  // Variable insertion helpers
  // -------------------------------------------------------------------------

  /**
   * Inserts a template variable at the current cursor position in a textarea or
   * input element. Falls back to appending if the element has no selection.
   * Uses requestAnimationFrame to restore cursor position after React re-renders.
   *
   * The new text is returned so the caller can save it straight away: the
   * field's state and its DOM value only change on the next render.
   *
   * @param elRef    - Ref to the target textarea or input.
   * @param variable - The variable string to insert, e.g. "{client_name}".
   * @param current  - Current field value.
   * @param setter   - State setter for the field.
   * @returns        The field's new text.
   */
  function insertAtCursor(
    elRef: { current: HTMLTextAreaElement | HTMLInputElement | null },
    variable: string,
    current: string,
    setter: (fn: (prev: string) => string) => void,
  ): string {
    const el    = elRef.current;
    const pos   = el?.selectionStart ?? current.length;
    const end   = el?.selectionEnd   ?? pos;
    const next  = insertVariable(current, pos, end, variable);
    setter(() => next.value);
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(next.cursor, next.cursor);
      }
    });
    return next.value;
  }

  return {
    emailBodyTextareaRef,
    emailSubjectTextareaRef,
    emailGreetingTextareaRef,
    emailClosingTextareaRef,
    emailFooterTextareaRef,
    insertAtCursor,
  };
}
