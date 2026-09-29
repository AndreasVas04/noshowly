/**
 * components/dashboard/appointment-modal/ClientFields.tsx
 *
 * Client fields of the appointment modal:
 *  - Phone (primary identifier). In create mode, typing 6+ digits looks up
 *    the client; a match fills in the name and email and locks the name
 *    field (click it to edit).
 *  - Client name with autocomplete suggestions (create mode). Without a
 *    selected client, a new one is created on save. In edit mode the fields
 *    edit the linked client's details.
 *  - Email (optional).
 */

'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MAX_PHONE_INPUT_LENGTH } from '@/lib/contact';
import type { AppointmentWithDetails } from '@/types';
import type { FieldErrors, FormState, SetField } from './form';
import { inputClass, labelClass } from './styles';
import type { ClientLookup } from './useClientLookup';

/** Props accepted by ClientFields. */
interface ClientFieldsProps {
  /** Current form values. */
  form: FormState;
  /** Per-field validation messages. */
  fieldErrors: FieldErrors;
  /** Whether the modal edits an existing appointment. */
  isEditMode: boolean;
  /** True when viewing a cancelled appointment; the fields are disabled. */
  isCancelledView: boolean;
  /** The edited appointment (edit mode only). */
  appointment?: AppointmentWithDetails;
  /** Client lookup state and handlers (useClientLookup). */
  lookup: ClientLookup;
  /** Updates a form field and clears its error. */
  setField: SetField;
}

/**
 * ClientFields renders the phone, client name (with suggestions) and email fields.
 *
 * @param props.form            - Current form values.
 * @param props.fieldErrors     - Per-field validation messages.
 * @param props.isEditMode      - Whether an existing appointment is edited.
 * @param props.isCancelledView - Disables the fields for a cancelled appointment.
 * @param props.appointment     - The edited appointment (edit mode only).
 * @param props.lookup          - Client lookup state and handlers.
 * @param props.setField        - Updates a form field.
 */
export default function ClientFields({
  form,
  fieldErrors,
  isEditMode,
  isCancelledView,
  appointment,
  lookup,
  setField,
}: ClientFieldsProps) {
  const {
    suggestions,
    showSuggestions,
    setShowSuggestions,
    isSearching,
    isPhoneSearching,
    clientFoundByPhone,
    nameReadOnly,
    handleClientQueryChange,
    handlePhoneChange,
    handleNameUnlock,
    handleSelectClient,
  } = lookup;

  return (
    <>
      {/* ---- Phone (primary identifier) --------------------------- */}
      {/* Typing 6+ digits triggers a client lookup (create mode) */}
      <div className="space-y-1.5">
        <Label htmlFor="modal-client-phone" className={labelClass}>
          Phone <span className="text-red-400">*</span>
        </Label>
        <Input
          id="modal-client-phone"
          type="tel"
          autoFocus
          disabled={isCancelledView}
          value={form.clientPhone}
          onChange={(e) => handlePhoneChange(e.target.value)}
          placeholder="+357 99 123 456"
          maxLength={MAX_PHONE_INPUT_LENGTH}
          className={inputClass(Boolean(fieldErrors.clientPhone))}
        />
        {isPhoneSearching && (
          <p className="text-xs text-[#C8C8C8]">Searching...</p>
        )}
        {!isPhoneSearching && clientFoundByPhone && form.selectedClient && (
          <p className="text-xs text-emerald-600">Existing client: {form.selectedClient.name}</p>
        )}
        {fieldErrors.clientPhone && (
          <p className="text-xs text-red-600">{fieldErrors.clientPhone}</p>
        )}
      </div>

      {/* ---- Client name with autocomplete ------------------------ */}
      <div className="space-y-1.5">
        <Label htmlFor="modal-client-name" className={labelClass}>
          Client name <span className="text-red-400">*</span>
        </Label>
        <div className="relative">
          <Input
            id="modal-client-name"
            type="text"
            autoComplete="off"
            readOnly={nameReadOnly}
            disabled={isCancelledView}
            value={form.clientQuery}
            onChange={(e) => handleClientQueryChange(e.target.value)}
            onClick={() => { if (nameReadOnly) handleNameUnlock(); }}
            onFocus={() => {
              if (suggestions.length > 0 && !nameReadOnly) setShowSuggestions(true);
            }}
            onBlur={() => {
              setTimeout(() => setShowSuggestions(false), 150);
            }}
            placeholder={isEditMode ? 'Client name' : 'Search or enter new name'}
            maxLength={100}
            className={inputClass(Boolean(fieldErrors.clientQuery))}
            style={{ cursor: nameReadOnly ? 'pointer' : 'text', background: nameReadOnly ? '#F9F9F9' : undefined }}
          />

          {/* Autocomplete dropdown (create mode) */}
          {!isEditMode && showSuggestions && !nameReadOnly && (
            <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-[#C8C8C8]/40 rounded-xl shadow-lg max-h-40 overflow-y-auto">
              {isSearching && <p className="px-3 py-2 text-sm text-[#C8C8C8]">Searching...</p>}
              {!isSearching && suggestions.length === 0 && (
                <p className="px-3 py-2 text-sm text-[#C8C8C8]">No match. A new client will be created on save.</p>
              )}
              {!isSearching && suggestions.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  onMouseDown={() => handleSelectClient(client)}
                  className="w-full text-left px-3 py-2 hover:bg-[#1A1A1A]/5 transition-colors border-b border-[#C8C8C8]/20 last:border-0"
                >
                  <p className="text-sm font-medium text-[#1A1A1A]">{client.name}</p>
                  {client.phone && <p className="text-xs text-[#C8C8C8] mt-0.5">{client.phone}</p>}
                </button>
              ))}
            </div>
          )}
        </div>

        {nameReadOnly && <p className="text-xs text-[#C8C8C8]">Click to edit</p>}
        {!isEditMode && !nameReadOnly && form.selectedClient && !clientFoundByPhone && (
          <p className="text-xs text-[#C8C8C8]">Existing client selected</p>
        )}
        {!isEditMode && !nameReadOnly && !form.selectedClient && form.clientQuery && !isSearching && (
          <p className="text-xs text-[#C8C8C8]">New client (will be created on save)</p>
        )}
        {isEditMode && appointment?.client_id && (
          <p className="text-xs text-[#C8C8C8]">Changes to the client&apos;s details are saved to their client record.</p>
        )}
        {fieldErrors.clientQuery && (
          <p className="text-xs text-red-600">{fieldErrors.clientQuery}</p>
        )}
      </div>

      {/* ---- Email (optional) -------------------------------------- */}
      <div className="space-y-1.5">
        <Label htmlFor="modal-client-email" className={labelClass}>
          Email <span className="text-xs font-normal text-[#C8C8C8]">(optional)</span>
        </Label>
        <Input
          id="modal-client-email"
          type="email"
          disabled={isCancelledView}
          value={form.clientEmail}
          onChange={(e) => setField('clientEmail', e.target.value)}
          placeholder="client@example.com"
          maxLength={254}
          className={inputClass(Boolean(fieldErrors.clientEmail))}
        />
        {fieldErrors.clientEmail && (
          <p className="text-xs text-red-600">{fieldErrors.clientEmail}</p>
        )}
      </div>
    </>
  );
}
