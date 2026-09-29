/**
 * components/dashboard/booking-settings/useServicesEditor.ts
 *
 * State and handlers of the "Services" section of the booking settings page
 * (ServicesSection): the salon's service catalogue, active and inactive, with
 * adding (POST /api/services), inline editing and the "Available on booking
 * page" toggle (PUT /api/services/[id]), and removing
 * (DELETE /api/services/[id]). A failed change shows its message next to the
 * service (serviceErrors) or in the add form (addSvcError).
 */

'use client';

import { useState, useCallback } from 'react';
import { parseServiceForm, type ServiceFormState } from '@/components/dashboard/booking-settings/form-state';
import { responseError } from '@/lib/utils';
import type { BarberService, Service } from '@/types';

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
  const [addSvcForm, setAddSvcForm] = useState<ServiceFormState>({ name: '', duration: '', price: '' });
  const [addingSvc, setAddingSvc] = useState(false);
  const [addSvcError, setAddSvcError] = useState('');
  const [editingSvcId, setEditingSvcId] = useState<string | null>(null);
  const [svcEditForms, setSvcEditForms] = useState<Record<string, ServiceFormState>>({});
  const [savingSvcId, setSavingSvcId] = useState<string | null>(null);
  const [deletingSvcId, setDeletingSvcId] = useState<string | null>(null);
  /** Per service: why its last edit, toggle or removal failed. */
  const [serviceErrors, setServiceErrors] = useState<Record<string, string>>({});

  /**
   * Shows a message next to a service, or clears it with null.
   *
   * @param serviceId - UUID of the service.
   * @param message   - What went wrong, or null.
   */
  const setServiceError = useCallback((serviceId: string, message: string | null): void => {
    setServiceErrors((prev) => {
      if (message === null) {
        if (!(serviceId in prev)) return prev;
        const next = { ...prev };
        delete next[serviceId];
        return next;
      }
      return { ...prev, [serviceId]: message };
    });
  }, []);

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
    const parsed = parseServiceForm(addSvcForm);
    if (!parsed.ok) { setAddSvcError(parsed.error); return; }

    setAddingSvc(true);
    setAddSvcError('');

    try {
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.values),
      });

      if (!res.ok) {
        setAddSvcError(await responseError(res, 'Failed to add service. Please try again.'));
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

    const parsed = parseServiceForm(form);
    if (!parsed.ok) { setServiceError(serviceId, parsed.error); return; }

    setServiceError(serviceId, null);
    setSavingSvcId(serviceId);

    try {
      const res = await fetch(`/api/services/${serviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.values),
      });

      if (!res.ok) {
        setServiceError(serviceId, await responseError(res, 'Failed to save. Please try again.'));
        return;
      }

      const { service } = (await res.json()) as { service: Service };
      setSalonServices((prev) =>
        prev.map((s) => (s.id === serviceId ? service : s)).sort((a, b) => a.name.localeCompare(b.name))
      );
      setEditingSvcId(null);
    } catch {
      setServiceError(serviceId, 'Something went wrong. Please check your connection and try again.');
    } finally {
      setSavingSvcId(null);
    }
  }

  /**
   * Turns a service's row into its edit form, filled with its saved values.
   *
   * @param service - The service to edit.
   */
  function startEditingService(service: Service): void {
    setServiceError(service.id, null);
    setEditingSvcId(service.id);
    setSvcEditForms((prev) => ({
      ...prev,
      [service.id]: {
        name: service.name,
        duration: service.duration_minutes?.toString() ?? '',
        price: service.price != null ? String(service.price) : '',
      },
    }));
  }

  /**
   * Closes a service's edit form without saving.
   *
   * @param serviceId - UUID of the service.
   */
  function cancelEditingService(serviceId: string): void {
    setServiceError(serviceId, null);
    setEditingSvcId(null);
  }

  /**
   * Toggles the active flag on a global service via PUT /api/services/[id].
   *
   * @param serviceId - UUID of the service.
   * @param active    - New active state.
   */
  async function handleToggleGlobalService(serviceId: string, active: boolean): Promise<void> {
    setServiceError(serviceId, null);
    try {
      const res = await fetch(`/api/services/${serviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });

      if (!res.ok) {
        setServiceError(serviceId, await responseError(res, 'Failed to update. Please try again.'));
        return;
      }

      const { service } = (await res.json()) as { service: Service };
      setSalonServices((prev) => prev.map((s) => (s.id === serviceId ? service : s)));
    } catch {
      setServiceError(serviceId, 'Something went wrong. Please check your connection and try again.');
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

    setServiceError(serviceId, null);
    setDeletingSvcId(serviceId);

    try {
      const res = await fetch(`/api/services/${serviceId}`, { method: 'DELETE' });
      if (!res.ok) {
        setServiceError(serviceId, await responseError(res, 'Failed to remove. Please try again.'));
        return;
      }
      setSalonServices((prev) => prev.filter((s) => s.id !== serviceId));
      // Also clean up any barber_services assignments for this service from local state.
      updateBarberServiceAssignments((prev) => prev.filter((ba) => ba.service_id !== serviceId));
    } catch {
      setServiceError(serviceId, 'Something went wrong. Please check your connection and try again.');
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
    svcEditForms,
    setSvcEditForms,
    savingSvcId,
    deletingSvcId,
    serviceErrors,
    initServices,
    startEditingService,
    cancelEditingService,
    handleAddGlobalService,
    handleSaveGlobalServiceEdit,
    handleToggleGlobalService,
    handleDeleteGlobalService,
  };
}

/** State and handlers returned by useServicesEditor. */
export type ServicesEditor = ReturnType<typeof useServicesEditor>;
