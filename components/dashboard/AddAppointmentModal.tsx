/**
 * components/dashboard/AddAppointmentModal.tsx
 *
 * Modal for creating and editing appointments.
 *
 * Modes:
 *  - Create mode (no `appointment` prop): empty form pre-filled with initialDate.
 *    Client autocomplete — type to search existing clients, or enter a new name.
 *  - Edit mode (`appointment` prop): pre-filled with existing appointment data.
 *    Shows a "Cancel appointment" button. The client fields edit the linked
 *    client's details (saved with PATCH /api/clients/[id]); only fields that
 *    changed are sent, so a status the client set meanwhile (e.g. confirmed
 *    from the reminder email) is never overwritten with a stale value.
 *
 * Client flow (create mode):
 *  - Typing in the client name field triggers a debounced GET /api/clients search.
 *  - Selecting a client pre-fills phone and email.
 *  - Phone field also triggers a debounced client lookup on 6+ digits.
 *  - No existing client selected → client found or created via POST /api/clients on save.
 *
 * Dates and times are entered in the salon's timezone (not the browser's) and
 * converted to UTC on save. The appointment length is resolved by the server
 * from the service and staff member (their override); the modal shows it.
 *
 * Structure: this file renders the dialog (header, form body, sticky footer
 * and the soft-warning overlay). The rest lives in
 * components/dashboard/appointment-modal/:
 *  - useAppointmentForm: form state, the reset each time the modal opens and
 *    the derived values. It composes useModalData (staff, services, business
 *    hours and staff/service assignments), useClientLookup (client search and
 *    phone lookup) and useAppointmentSave (submit, save, cancel and test
 *    reminder requests).
 *  - ClientFields, DateTimeFields, ServiceStaffFields and StatusAndNotes: the
 *    form's field groups. WarningDialog: the soft-warning confirmation.
 *  - form.ts, validation.ts and payloads.ts: pure helpers for the form state,
 *    validation and request bodies. styles.ts: classes the fields share.
 *
 * Premium design: shadcn Dialog + Input + Label + Button components,
 * brand-dark palette, generous whitespace.
 */

'use client';

import { X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Badge from '@/components/ui/Badge';
import { Button } from '@/components/ui/button';
import ClientFields from '@/components/dashboard/appointment-modal/ClientFields';
import DateTimeFields from '@/components/dashboard/appointment-modal/DateTimeFields';
import ServiceStaffFields from '@/components/dashboard/appointment-modal/ServiceStaffFields';
import StatusAndNotes from '@/components/dashboard/appointment-modal/StatusAndNotes';
import WarningDialog from '@/components/dashboard/appointment-modal/WarningDialog';
import useAppointmentForm from '@/components/dashboard/appointment-modal/useAppointmentForm';
import type { AppointmentWithDetails } from '@/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AddAppointmentModalProps {
  /** Whether the modal is visible. */
  isOpen: boolean;
  /** Called when dismissed without saving. */
  onClose: () => void;
  /** Called after a successful save. */
  onSaved: () => void;
  /** Salon timezone; dates and times in the form are in this timezone. */
  timezone: string;
  /** Salon date ('YYYY-MM-DD') to pre-fill when creating. Defaults to today in the salon. */
  initialDate?: string;
  /** Barber UUID to pre-select (create mode only). */
  initialBarberId?: string;
  /** If provided, opens in edit mode pre-filled with this appointment. */
  appointment?: AppointmentWithDetails;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * AddAppointmentModal renders a shadcn Dialog with a form for creating or
 * editing an appointment.
 *
 * @param props.isOpen          - Whether the modal is visible.
 * @param props.onClose         - Dismiss without saving.
 * @param props.onSaved         - Called after a successful save.
 * @param props.timezone        - Salon timezone.
 * @param props.initialDate     - Salon date to pre-fill in create mode.
 * @param props.initialBarberId - Staff member to pre-select in create mode.
 * @param props.appointment     - If provided, opens in edit mode.
 */
export default function AddAppointmentModal({
  isOpen,
  onClose,
  onSaved,
  timezone,
  initialDate,
  initialBarberId,
  appointment,
}: AddAppointmentModalProps) {
  const {
    isEditMode,
    form,
    setForm,
    setField,
    fieldErrors,
    setStatusTouched,
    showNotes,
    setShowNotes,
    data,
    lookup,
    save,
    selectableBarbers,
    selectedService,
    resolvedDuration,
    displayedStatus,
    handleServiceChange,
  } = useAppointmentForm({ isOpen, onSaved, timezone, initialDate, initialBarberId, appointment });
  const { isLoadingBarbers, services, isLoadingServices, barberServices, salonHours, isDemo } = data;
  const {
    isSendingTestReminder,
    testReminderResult,
    warningDialog,
    setWarningDialog,
    isSubmitting,
    isCancelling,
    error,
    doSave,
    handleSubmit,
    handleCancelAppointment,
    handleTestReminder,
  } = save;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const title = isEditMode ? 'Edit appointment' : 'New appointment';
  /** True when viewing a cancelled appointment — all fields disabled, save hidden. */
  const isCancelledView = isEditMode && appointment?.status === 'cancelled';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => { if (!open && !isSubmitting && !isCancelling) onClose(); }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-lg max-h-[90dvh] flex flex-col p-0 gap-0 rounded-2xl border-[#C8C8C8]/40"
      >
        {/* ================================================================
            Header
        ================================================================ */}
        <DialogHeader className="flex-row items-center justify-between px-6 py-4 border-b border-[#C8C8C8]/30 shrink-0 gap-0">
          <DialogTitle className="font-heading text-lg font-semibold text-[#1A1A1A]">
            {title}
          </DialogTitle>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-[#C8C8C8] hover:text-[#1A1A1A] hover:bg-[#1A1A1A]/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </DialogHeader>

        {/* ================================================================
            Form — scrollable body + sticky footer
        ================================================================ */}
        <form onSubmit={handleSubmit} noValidate className="flex-1 flex flex-col min-h-0">

          {/* Scrollable fields */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

            {/* Global error */}
            {error && (
              <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* ---- Read-only cancelled badge (edit mode, cancelled only) --- */}
            {isCancelledView && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[#8A8680]">Status:</span>
                <Badge status="cancelled" />
              </div>
            )}

            <ClientFields
              form={form}
              fieldErrors={fieldErrors}
              isEditMode={isEditMode}
              isCancelledView={isCancelledView}
              appointment={appointment}
              lookup={lookup}
              setField={setField}
            />

            <DateTimeFields
              form={form}
              fieldErrors={fieldErrors}
              isCancelledView={isCancelledView}
              salonHours={salonHours}
              timezone={timezone}
              setField={setField}
            />

            <ServiceStaffFields
              form={form}
              fieldErrors={fieldErrors}
              isCancelledView={isCancelledView}
              isLoadingServices={isLoadingServices}
              services={services}
              selectedService={selectedService}
              isLoadingBarbers={isLoadingBarbers}
              selectableBarbers={selectableBarbers}
              barberServices={barberServices}
              resolvedDuration={resolvedDuration}
              handleServiceChange={handleServiceChange}
              setForm={setForm}
              setField={setField}
            />

            <StatusAndNotes
              form={form}
              isCancelledView={isCancelledView}
              displayedStatus={displayedStatus}
              setStatusTouched={setStatusTouched}
              showNotes={showNotes}
              setShowNotes={setShowNotes}
              setField={setField}
            />

          </div>

          {/* ================================================================
              Sticky footer
          ================================================================ */}
          <div className="shrink-0 px-6 py-4 border-t border-[#C8C8C8]/30 space-y-2">

            {/* Test reminder result banner */}
            {testReminderResult && (
              <div className={`text-xs px-3 py-2 rounded-lg ${
                testReminderResult.success
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                  : 'bg-red-50 text-red-700 border border-red-100'
              }`}>
                {testReminderResult.message}
              </div>
            )}

            {/* flex-wrap keeps all buttons inside the modal on small screens.
                ml-auto on the Close/Save group pushes them right on wider screens;
                on narrow screens they wrap to their own row, right-aligned. */}
            <div className="flex flex-wrap items-center gap-2">

            {/* Cancel appointment (edit mode, not already cancelled) */}
            {isEditMode && appointment?.status !== 'cancelled' && (
              <button
                type="button"
                onClick={handleCancelAppointment}
                disabled={isCancelling || isSubmitting}
                className="
                  px-3 py-2 rounded-lg text-xs font-medium
                  text-red-600 border border-red-200 hover:bg-red-50
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-colors shrink-0
                "
              >
                {isCancelling ? 'Cancelling...' : 'Cancel appointment'}
              </button>
            )}

            {/* Send test reminder (edit mode, not cancelled, client has email) */}
            {isEditMode && appointment?.status !== 'cancelled' && appointment?.client_email && (
              <button
                type="button"
                onClick={() => { void handleTestReminder(); }}
                disabled={isSendingTestReminder || isSubmitting || isCancelling}
                className="
                  px-3 py-2 rounded-lg text-xs font-medium
                  text-[#1B4332] border border-[#1B4332]/30 hover:bg-[#E8F2EC]
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-colors shrink-0
                "
              >
                {isSendingTestReminder ? 'Sending...' : 'Send reminder'}
              </button>
            )}

            {isDemo && isEditMode && appointment?.status !== 'cancelled' && appointment?.client_email && (
              <p className="text-[10px] text-[#8A8680] italic mt-1">Demo mode: reminder emails are sent only to the demo account owner, not to clients.</p>
            )}

            {/* ml-auto pushes Close + Save to the right; wraps to its own row on small screens */}
            <div className="flex items-center gap-2 ml-auto">

            {/* Close */}
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting || isCancelling}
              className="border-[#C8C8C8] text-[#1A1A1A] hover:bg-[#1A1A1A]/5 hover:border-[#1A1A1A]/40 text-sm px-4 py-2 h-9"
            >
              Close
            </Button>

            {/* Save — hidden for cancelled appointments (read-only view) */}
            {!isCancelledView && (
              <Button
                type="submit"
                disabled={isSubmitting || isCancelling}
                className="bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm px-5 py-2 h-9"
              >
                {isSubmitting ? 'Saving...' : 'Save'}
              </Button>
            )}

            </div>{/* end Close+Save group */}
            </div>{/* end flex-wrap row */}
          </div>
        </form>

        {/* ================================================================
            Soft-warning confirmation dialog
            Overlaid inside the modal when appointment has soft warnings.
        ================================================================ */}
        {warningDialog !== null && (
          <WarningDialog
            message={warningDialog}
            onGoBack={() => setWarningDialog(null)}
            onConfirm={() => { void doSave(); }}
          />
        )}

      </DialogContent>
    </Dialog>
  );
}
