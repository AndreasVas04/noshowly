/**
 * components/dashboard/appointment-modal/styles.ts
 *
 * Class names shared by the appointment modal's field groups.
 */

// Shared input class helpers

/**
 * Classes of the modal's client inputs, with a red border when the field has an error.
 *
 * @param hasError - Whether the field has a validation error.
 */
export const inputClass = (hasError?: boolean) =>
  `h-10 text-sm text-[#1A1A1A] placeholder:text-[#C8C8C8] ${
    hasError
      ? 'border-red-400 focus-visible:border-red-400'
      : 'border-[#C8C8C8] focus-visible:border-[#1A1A1A]'
  } focus-visible:ring-0`;

/** Classes of the modal's field labels. */
export const labelClass = 'text-xs font-medium text-[#1A1A1A]';
