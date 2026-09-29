/**
 * components/dashboard/booking-settings/ServicesSection.tsx
 *
 * Section 2 of the booking settings page: the salon's service catalogue.
 * Each service shows its duration and price, an "Available on booking page"
 * checkbox and Edit / Remove actions; Edit turns the row into an inline form.
 * "+ Add service" opens the add form below the list. A failed change shows
 * its message under the service or in the add form.
 *
 * State and handlers come from useServicesEditor.
 */

'use client';

import { SectionCard } from '@/components/dashboard/booking-settings/controls';
import type { ServicesEditor } from '@/components/dashboard/booking-settings/useServicesEditor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Props accepted by ServicesSection. */
interface ServicesSectionProps {
  /** Service catalogue state and handlers (useServicesEditor). */
  services: ServicesEditor;
  /** Display symbol of the salon's currency, e.g. "€". */
  currencySymbol: string;
}

/**
 * ServicesSection renders the "Services" section: the service list with
 * inline editing, and the add form.
 *
 * @param props.services       - Service catalogue state and handlers.
 * @param props.currencySymbol - Currency symbol shown with prices.
 */
export default function ServicesSection({ services, currencySymbol }: ServicesSectionProps) {
  const {
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
    startEditingService,
    cancelEditingService,
    handleAddGlobalService,
    handleSaveGlobalServiceEdit,
    handleToggleGlobalService,
    handleDeleteGlobalService,
  } = services;

  return (
    <section>
      <h2 className="font-heading text-base font-semibold text-[#1A1A1A] mb-1">Services</h2>
      <p className="text-sm text-[#6F6B65] mb-4">
        Define the services you offer. Toggle &quot;Available on booking page&quot; to control what clients can book.
      </p>

      <SectionCard>
        <div className="p-6 space-y-0">
          {salonServices.length === 0 && !showAddSvcForm && (
            <p className="text-sm text-[#6F6B65] py-2">No services yet. Add your first service below.</p>
          )}

          {salonServices.length > 0 && (
            <ul className="divide-y divide-[#E5E2DB]/30 mb-4">
              {salonServices.map((svc) => (
                <li key={svc.id} className="py-3">
                  {editingSvcId === svc.id ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-1 space-y-1">
                          <Label htmlFor={`service-${svc.id}-name`} className="text-xs text-[#6F6B65]">Name</Label>
                          <Input
                            id={`service-${svc.id}-name`}
                            value={svcEditForms[svc.id]?.name ?? ''}
                            onChange={(e) => setSvcEditForms((prev) => ({ ...prev, [svc.id]: { ...prev[svc.id], name: e.target.value } }))}
                            maxLength={50}
                            className="border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`service-${svc.id}-duration`} className="text-xs text-[#6F6B65]">Min</Label>
                          <Input
                            id={`service-${svc.id}-duration`}
                            type="number"
                            min={1}
                            value={svcEditForms[svc.id]?.duration ?? ''}
                            onChange={(e) => setSvcEditForms((prev) => ({ ...prev, [svc.id]: { ...prev[svc.id], duration: e.target.value } }))}
                            placeholder="30"
                            className="border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`service-${svc.id}-price`} className="text-xs text-[#6F6B65]">Price</Label>
                          <Input
                            id={`service-${svc.id}-price`}
                            type="number"
                            min={0}
                            step={0.01}
                            value={svcEditForms[svc.id]?.price ?? ''}
                            onChange={(e) => setSvcEditForms((prev) => ({ ...prev, [svc.id]: { ...prev[svc.id], price: e.target.value } }))}
                            placeholder="25.00"
                            className="border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-xs"
                          />
                        </div>
                      </div>
                      {serviceErrors[svc.id] && (
                        <p role="alert" className="text-xs text-red-600">{serviceErrors[svc.id]}</p>
                      )}
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          disabled={savingSvcId === svc.id}
                          onClick={() => void handleSaveGlobalServiceEdit(svc.id)}
                          className="bg-[#1B4332] hover:bg-[#16392A] text-white text-xs px-3 py-1.5 h-auto"
                        >
                          {savingSvcId === svc.id ? 'Saving…' : 'Save'}
                        </Button>
                        <button
                          type="button"
                          onClick={() => cancelEditingService(svc.id)}
                          className="text-xs text-[#6F6B65] hover:text-[#1A1A1A] transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`text-sm ${svc.active ? 'text-[#1A1A1A]' : 'text-[#6F6B65]'}`}>{svc.name}</p>
                        {(svc.duration_minutes || svc.price != null) && (
                          <p className="text-xs text-[#6F6B65] mt-0.5">
                            {[
                              svc.duration_minutes ? `${svc.duration_minutes} min` : null,
                              svc.price != null ? `${currencySymbol}${Number(svc.price).toFixed(2)}` : null,
                            ].filter(Boolean).join(' · ')}
                          </p>
                        )}
                        <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer select-none w-fit">
                          <input
                            type="checkbox"
                            checked={svc.active}
                            onChange={(e) => void handleToggleGlobalService(svc.id, e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-[#E5E2DB] accent-[#1A1A1A] cursor-pointer"
                          />
                          <span className="text-xs text-[#6F6B65]">Available on booking page</span>
                        </label>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEditingService(svc)}
                          className="text-xs text-[#6F6B65] hover:text-[#1A1A1A] transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteGlobalService(svc.id, svc.name)}
                          disabled={deletingSvcId === svc.id}
                          className="text-xs text-[#6F6B65] hover:text-red-600 disabled:opacity-40 transition-colors"
                        >
                          {deletingSvcId === svc.id ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    </div>
                  )}
                  {editingSvcId !== svc.id && serviceErrors[svc.id] && (
                    <p role="alert" className="text-xs text-red-600 mt-1.5">{serviceErrors[svc.id]}</p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {showAddSvcForm ? (
            <div className="space-y-2 pt-1">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1 space-y-1">
                  <Label htmlFor="new-service-name" className="text-xs text-[#6F6B65]">Name *</Label>
                  <Input
                    id="new-service-name"
                    type="text"
                    value={addSvcForm.name}
                    onChange={(e) => { setAddSvcForm((prev) => ({ ...prev, name: e.target.value })); if (addSvcError) setAddSvcError(''); }}
                    placeholder="e.g. Haircut"
                    maxLength={50}
                    disabled={addingSvc}
                    className="border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-service-duration" className="text-xs text-[#6F6B65]">Min</Label>
                  <Input
                    id="new-service-duration"
                    type="number"
                    min={1}
                    value={addSvcForm.duration}
                    onChange={(e) => setAddSvcForm((prev) => ({ ...prev, duration: e.target.value }))}
                    placeholder="30"
                    disabled={addingSvc}
                    className="border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-service-price" className="text-xs text-[#6F6B65]">Price</Label>
                  <Input
                    id="new-service-price"
                    type="number"
                    min={0}
                    step={0.01}
                    value={addSvcForm.price}
                    onChange={(e) => setAddSvcForm((prev) => ({ ...prev, price: e.target.value }))}
                    placeholder="25.00"
                    disabled={addingSvc}
                    className="border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-xs"
                  />
                </div>
              </div>
              {addSvcError && <p role="alert" className="text-xs text-red-600">{addSvcError}</p>}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  disabled={addingSvc}
                  onClick={() => void handleAddGlobalService()}
                  className="bg-[#1B4332] hover:bg-[#16392A] text-white text-xs px-3 py-1.5 h-auto"
                >
                  {addingSvc ? 'Adding…' : 'Add'}
                </Button>
                <button
                  type="button"
                  onClick={() => { setShowAddSvcForm(false); setAddSvcError(''); }}
                  className="text-xs text-[#6F6B65] hover:text-[#1A1A1A] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setShowAddSvcForm(true); setAddSvcForm({ name: '', duration: '', price: '' }); }}
              className="text-xs font-medium text-[#1A1A1A] hover:text-[#2D2D2D] transition-colors mt-2"
            >
              + Add service
            </button>
          )}
        </div>
      </SectionCard>
    </section>
  );
}
