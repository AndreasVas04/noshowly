/**
 * components/dashboard/appointment-modal/useClientLookup.ts
 *
 * Client lookups of the appointment modal (create mode only):
 *  - Typing in the client name field triggers a debounced GET /api/clients
 *    search; the matches are offered as suggestions under the field.
 *  - Phone field also triggers a debounced client lookup on 6+ digits; a
 *    match fills in the client's name and email and locks the name field.
 *
 * In edit mode the client fields edit the linked client instead, so no
 * lookups run (a phone match could otherwise switch the client).
 */

'use client';

import { useState, useEffect, useRef, useCallback, type Dispatch, type SetStateAction } from 'react';
import type { Client } from '@/types';
import type { FieldErrors, FormState, SetField } from './form';

/** What useClientLookup() reads and updates. */
interface ClientLookupOptions {
  /** Whether the modal edits an existing appointment (no lookups then). */
  isEditMode: boolean;
  /** Current form values. */
  form: FormState;
  /** Sets the form state. */
  setForm: Dispatch<SetStateAction<FormState>>;
  /** Updates a form field and clears its error. */
  setField: SetField;
  /** Sets the per-field validation messages. */
  setFieldErrors: Dispatch<SetStateAction<FieldErrors>>;
}

/**
 * Client name autocomplete and phone lookup for the appointment modal.
 *
 * @param options - The modal's form state and setters.
 * @returns The lookup state, the client field handlers, and reset() for a new opening.
 */
export default function useClientLookup({
  isEditMode,
  form,
  setForm,
  setField,
  setFieldErrors,
}: ClientLookupOptions) {
  // ---------------------------------------------------------------------------
  // Client autocomplete state (create mode only)
  // ---------------------------------------------------------------------------

  const [suggestions, setSuggestions] = useState<Client[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isPhoneSearching, setIsPhoneSearching] = useState(false);
  const [clientFoundByPhone, setClientFoundByPhone] = useState(false);
  const [nameReadOnly, setNameReadOnly] = useState(false);
  const phoneSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------------
  // Client lookups (create mode only)
  // ---------------------------------------------------------------------------

  /**
   * Debounced client name search — fires 300 ms after the user stops typing.
   *
   * @param query - The search term to send to GET /api/clients.
   */
  const searchClients = useCallback(async (query: string): Promise<void> => {
    if (!query.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch(`/api/clients?search=${encodeURIComponent(query)}`, { cache: 'no-store' });
      if (res.ok) {
        const payload = (await res.json()) as { clients: Client[] };
        setSuggestions(payload.clients);
        setShowSuggestions(true);
      }
    } catch (err) {
      console.error('[AddAppointmentModal] Client search error:', err);
    } finally {
      setIsSearching(false);
    }
  }, []);

  /**
   * Phone-based client lookup — fires after 6+ digits are present.
   * Auto-fills name + email on match and locks the name field.
   *
   * @param phone - Current value of the phone input.
   */
  const searchByPhone = useCallback(async (phone: string): Promise<void> => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 6) return;
    setIsPhoneSearching(true);
    try {
      const res = await fetch(`/api/clients?search=${encodeURIComponent(phone)}`, { cache: 'no-store' });
      if (!res.ok) return;
      const payload = (await res.json()) as { clients: Client[] };
      const match = payload.clients[0] ?? null;
      if (match) {
        setForm((prev) => ({
          ...prev,
          clientQuery: match.name,
          selectedClient: match,
          clientEmail: match.email ?? prev.clientEmail,
        }));
        setClientFoundByPhone(true);
        setNameReadOnly(true);
        setFieldErrors((prev) => {
          const next = { ...prev };
          delete next.clientQuery;
          delete next.clientPhone;
          return next;
        });
      } else {
        setClientFoundByPhone(false);
        setNameReadOnly(false);
      }
    } catch (err) {
      console.error('[AddAppointmentModal] Phone search error:', err);
    } finally {
      setIsPhoneSearching(false);
    }
  }, [setForm, setFieldErrors]);

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Debounced client name search (create mode only).
  useEffect(() => {
    if (isEditMode || form.selectedClient) return;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => { searchClients(form.clientQuery); }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [isEditMode, form.clientQuery, form.selectedClient, searchClients]);

  // Debounced phone lookup (create mode only — in edit mode it could switch the client).
  useEffect(() => {
    if (isEditMode) return;
    if (phoneSearchTimerRef.current) clearTimeout(phoneSearchTimerRef.current);
    phoneSearchTimerRef.current = setTimeout(() => { searchByPhone(form.clientPhone); }, 400);
    return () => { if (phoneSearchTimerRef.current) clearTimeout(phoneSearchTimerRef.current); };
  }, [isEditMode, form.clientPhone, searchByPhone]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  /**
   * Handles client name input. In create mode it clears selectedClient to
   * trigger a new search; in edit mode it edits the linked client's name.
   *
   * @param value - New text in the client name field.
   */
  function handleClientQueryChange(value: string): void {
    setField('clientQuery', value);
    if (!isEditMode && form.selectedClient) {
      setForm((prev) => ({ ...prev, clientQuery: value, selectedClient: null }));
    }
  }

  /**
   * Handles phone field changes. Clears auto-filled data if phone changes after a match.
   *
   * @param value - New phone input value.
   */
  function handlePhoneChange(value: string): void {
    if (!isEditMode && clientFoundByPhone) {
      setClientFoundByPhone(false);
      setNameReadOnly(false);
      setForm((prev) => ({ ...prev, clientPhone: value, clientQuery: '', selectedClient: null }));
    } else {
      setField('clientPhone', value);
    }
  }

  /** Unlocks the client name field when clicked while read-only. */
  function handleNameUnlock(): void {
    setNameReadOnly(false);
    setClientFoundByPhone(false);
    setForm((prev) => ({ ...prev, selectedClient: null }));
  }

  /**
   * Selects a client from the autocomplete dropdown — pre-fills phone + email.
   *
   * @param client - The selected client record.
   */
  function handleSelectClient(client: Client): void {
    setForm((prev) => ({
      ...prev,
      clientQuery: client.name,
      selectedClient: client,
      clientPhone: client.phone ?? prev.clientPhone,
      clientEmail: client.email ?? prev.clientEmail,
    }));
    setShowSuggestions(false);
    setSuggestions([]);
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.clientQuery;
      delete next.clientPhone;
      return next;
    });
  }

  /**
   * Clears the suggestions and the phone match. Called while rendering when
   * the modal opens, so every opening starts without them.
   */
  function reset(): void {
    setSuggestions([]);
    setShowSuggestions(false);
    setIsPhoneSearching(false);
    setClientFoundByPhone(false);
    setNameReadOnly(false);
  }

  return {
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
    reset,
  };
}

/** Client lookup state and handlers, as returned by useClientLookup(). */
export type ClientLookup = ReturnType<typeof useClientLookup>;
