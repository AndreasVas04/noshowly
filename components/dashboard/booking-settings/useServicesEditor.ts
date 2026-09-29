/**
 * components/dashboard/booking-settings/useServicesEditor.ts
 *
 * State and handlers of the "Services" section of the booking settings page
 * (ServicesSection): the salon's service catalogue, active and inactive, with
 * adding (POST /api/services), inline editing and the "Available on booking
 * page" toggle (PUT /api/services/[id]), and removing
 * (DELETE /api/services/[id]).
 */

'use client';

import { useState, useCallback } from 'react';
import { MAX_DURATION_MINUTES, MIN_DURATION_MINUTES } from '@/lib/availability';
import type { BarberService, Service } from '@/types';

/** In-memory form state for adding/editing a global service. */
type ServiceEditForm = {
  name: string;
  duration: string;
  price: string;
};

/**
 * Owns the salon's service catalogue and the add and edit forms of the
 * Services section.
 *
 * @param updateBarberServiceAssignments - Updates the staff service
 *   assignments (useServiceAssignments); a removed service's assignments are
 *   dropped from them.
 * @returns The services, the form state and the handlers used by
 *          ServicesSection, plus initServices for the initial load.
 */
export function useServicesEditor(
  updateBarberServiceAssignments: (update: (prev: BarberService[]) => BarberService[]) => void,
) {
  // -------------------------------------------------------------------------
  // Global Services section state
  // -------------------------------------------------------------------------
  /** Salon-level services (from the services table) — used for assignment checkboxes. */
  const [salonServices, setSalonServices] = useState<Service[]>([]);
  const [showAddSvcForm, setShowAddSvcForm] = useState(false);
  const [addSvcForm, setAddSvcForm] = useState<ServiceEditForm>({ name: '', duration: '', price: '' });
  const [addingSvc, setAddingSvc] = useState(false);
  const [addSvcError, setAddSvcError] = useState('');
  const [editingSvcId, setEditingSvcId] = useState<string | null>(null);
  const [svcEditForms, setSvcEditForms] = useState<Record<string, ServiceEditForm>>({});
  const [savingSvcId, setSavingSvcId] = useState<string | null>(null);
  const [deletingSvcId, setDeletingSvcId] = useState<string | null>(null);

  /**
   * Sets the services loaded on mount.
   *
   * @param services - All services of the salon, active and inactive.
   */
  const initServices = useCallback((services: Service[]): void => {
    setSalonServices(services);
  }, []);

  // -------------------------------------------------------------------------
  // Global Services handlers
  // -------------------------------------------------------------------------

  /**
   * Adds a new global service via POST /api/services.
   */
  async function handleAddGlobalService(): Promise<void> {
    const trimmedName = addSvcForm.name.trim();
    if (!trimmedName) { setAddSvcError('Service name is required.'); return; }
    if (trimmedName.length > 50) { setAddSvcError('Name must be 50 characters or fewer.'); return; }

    const durationNum = addSvcForm.duration ? Number(addSvcForm.duration) : null;
    if (
      durationNum !== null &&
      (!Number.isInteger(durationNum) || durationNum < MIN_DURATION_MINUTES || durationNum > MAX_DURATION_MINUTES)
    ) {
      setAddSvcError(`Duration must be a whole number of minutes between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES}.`); return;
    }
    const priceNum = addSvcForm.price ? parseFloat(addSvcForm.price) : null;
    if (addSvcForm.price && (isNaN(priceNum!) || priceNum! < 0)) {
      setAddSvcError('Price must be a non-negative number.'); return;
    }

    setAddingSvc(true);
    setAddSvcError('');

    try {
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, duration_minutes: durationNum, price: priceNum }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setAddSvcError(data.error ?? 'Failed to add service. Please try again.');
        return;
      }

      const { service } = (await res.json()) as { service: Service };
      setSalonServices((prev) => [...prev, service].sort((a, b) => a.name.localeCompare(b.name)));
      setAddSvcForm({ name: '', duration: '', price: '' });
      setShowAddSvcForm(false);
    } catch {
      setAddSvcError('Something went wrong. Please try again.');
    } finally {
      setAddingSvc(false);
    }
  }

  /**
   * Saves inline edits for a global service via PUT /api/services/[id].
   *
   * @param serviceId - UUID of the service being edited.
   */
  async function handleSaveGlobalServiceEdit(serviceId: string): Promise<void> {
    const form = svcEditForms[serviceId];
    if (!form) return;

    const trimmedName = form.name.trim();
    if (!trimmedName) { alert('Service name is required.'); return; }
    if (trimmedName.length > 50) { alert('Name must be 50 characters or fewer.'); return; }

    const durationNum = form.duration ? Number(form.duration) : null;
    if (
      durationNum !== null &&
      (!Number.isInteger(durationNum) || durationNum < MIN_DURATION_MINUTES || durationNum > MAX_DURATION_MINUTES)
    ) {
      alert(`Duration must be a whole number of minutes between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES}.`); return;
    }
    const priceNum = form.price ? parseFloat(form.price) : null;
    if (form.price && (isNaN(priceNum!) || priceNum! < 0)) {
      alert('Price must be a non-negative number.'); return;
    }

    setSavingSvcId(serviceId);

    try {
      const res = await fetch(`/api/services/${serviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, duration_minutes: durationNum, price: priceNum }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? 'Failed to save. Please try again.');
        return;
      }

      const { service } = (await res.json()) as { service: Service };
      setSalonServices((prev) =>
        prev.map((s) => (s.id === serviceId ? service : s)).sort((a, b) => a.name.localeCompare(b.name))
      );
      setEditingSvcId(null);
    } catch {
      alert('Something went wrong. Please try again.');
    } finally {
      setSavingSvcId(null);
    }
  }

  /**
   * Toggles the active flag on a global service via PUT /api/services/[id].
   *
   * @param serviceId - UUID of the service.
   * @param active    - New active state.
   */
  async function handleToggleGlobalService(serviceId: string, active: boolean): Promise<void> {
    try {
      const res = await fetch(`/api/services/${serviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? 'Failed to update. Please try again.');
        return;
      }

      const { service } = (await res.json()) as { service: Service };
      setSalonServices((prev) => prev.map((s) => (s.id === serviceId ? service : s)));
    } catch {
      alert('Something went wrong. Please try again.');
    }
  }

  /**
   * Deletes a global service via DELETE /api/services/[id].
   *
   * @param serviceId   - UUID of the service.
   * @param serviceName - Used in the confirmation prompt.
   */
  async function handleDeleteGlobalService(serviceId: string, serviceName: string): Promise<void> {
    if (!window.confirm(`Remove "${serviceName}"? This cannot be undone.`)) return;

    setDeletingSvcId(serviceId);

    try {
      const res = await fetch(`/api/services/${serviceId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? 'Failed to remove. Please try again.');
        return;
      }
      setSalonServices((prev) => prev.filter((s) => s.id !== serviceId));
      // Also clean up any barber_services assignments for this service from local state.
      updateBarberServiceAssignments((prev) => prev.filter((ba) => ba.service_id !== serviceId));
    } catch {
      alert('Something went wrong. Please try again.');
    } finally {
      setDeletingSvcId(null);
    }
  }

  return {
    salonServices,
    showAddSvcForm,
    setShowAddSvcForm,
    addSvcForm,
    setAddSvcForm,
    addingSvc,
    addSvcError,
    setAddSvcError,
    editingSvcId,
    setEditingSvcId,
    svcEditForms,
    setSvcEditForms,
    savingSvcId,
    deletingSvcId,
    initServices,
    handleAddGlobalService,
    handleSaveGlobalServiceEdit,
    handleToggleGlobalService,
    handleDeleteGlobalService,
  };
}

/** State and handlers returned by useServicesEditor. */
export type ServicesEditor = ReturnType<typeof useServicesEditor>;
