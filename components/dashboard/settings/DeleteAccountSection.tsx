/**
 * components/dashboard/settings/DeleteAccountSection.tsx
 *
 * Settings section 6, Delete account: "Delete my account" opens a typed
 * confirmation; the account is only deleted once "DELETE" is typed
 * (useDeleteAccount). The public demo account cannot be deleted, so it gets a
 * note instead of the button.
 */

'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { AccountDeletion } from '@/components/dashboard/settings/useDeleteAccount';

type DeleteAccountSectionProps = {
  /** The public demo account cannot be deleted (the API also refuses it). */
  isDemo: boolean;
  /** Dialog state and the delete request. */
  deletion: AccountDeletion;
};

/**
 * Renders the Delete account section.
 *
 * @param props - The demo flag and the delete dialog state.
 * @returns The section JSX.
 */
export default function DeleteAccountSection({ isDemo, deletion }: DeleteAccountSectionProps) {
  const {
    showDeleteDialog,
    setShowDeleteDialog,
    deleteConfirmText,
    setDeleteConfirmText,
    isDeletingAccount,
    deleteAccountError,
    setDeleteAccountError,
    handleDeleteAccount,
  } = deletion;

  return (
    <section>
      <h2 className="text-base font-semibold text-red-600 mb-1">Delete account</h2>
      <p className="text-sm text-[#6F6B65] mb-4 font-body">
        Permanently deletes your business data, all appointments, all clients, and all reminders,
        and cancels your subscription. This cannot be undone.
      </p>

      <div className="bg-white rounded-2xl border border-red-100 p-6">

        {isDemo ? (
          <p className="text-sm text-[#6F6B65] font-body">
            The demo account can&apos;t be deleted. Sign up for your own account to try this.
          </p>
        ) : !showDeleteDialog ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setShowDeleteDialog(true);
              setDeleteConfirmText('');
              setDeleteAccountError('');
            }}
            className="border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400 text-sm"
          >
            Delete my account
          </Button>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[#1A1A1A]">
              This will cancel your subscription and permanently delete your business data, all appointments,
              all clients, and all reminders. This cannot be undone. Type <strong>DELETE</strong> to confirm.
            </p>

            <Input
              type="text"
              aria-label="Type DELETE to confirm"
              value={deleteConfirmText}
              onChange={(e) => {
                setDeleteConfirmText(e.target.value);
                if (deleteAccountError) setDeleteAccountError('');
              }}
              placeholder="Type DELETE to confirm"
              disabled={isDeletingAccount}
              className="border-[#C8C8C8] focus-visible:border-red-400 focus-visible:ring-0 text-[#1A1A1A]"
            />

            {deleteAccountError && (
              <div role="alert" className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
                {deleteAccountError}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== 'DELETE' || isDeletingAccount}
                className="bg-red-600 hover:bg-red-700 text-white text-sm disabled:opacity-40"
              >
                {isDeletingAccount ? 'Deleting…' : 'Yes, delete everything'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowDeleteDialog(false);
                  setDeleteConfirmText('');
                  setDeleteAccountError('');
                }}
                disabled={isDeletingAccount}
                className="border-[#E5E2DB] text-[#1A1A1A] text-sm"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

      </div>
    </section>
  );
}
