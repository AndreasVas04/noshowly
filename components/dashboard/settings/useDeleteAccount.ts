/**
 * components/dashboard/settings/useDeleteAccount.ts
 *
 * State of the Delete account section: the typed confirmation ("DELETE") and
 * DELETE /api/account. After a successful delete the browser goes to
 * /register with a full page load.
 */

'use client';

import { useState } from 'react';

/** The confirmation dialog state and the delete request. */
export type AccountDeletion = {
  showDeleteDialog: boolean;
  setShowDeleteDialog: React.Dispatch<React.SetStateAction<boolean>>;
  deleteConfirmText: string;
  setDeleteConfirmText: React.Dispatch<React.SetStateAction<string>>;
  isDeletingAccount: boolean;
  /** Error shown in the dialog; empty when there is none. */
  deleteAccountError: string;
  setDeleteAccountError: React.Dispatch<React.SetStateAction<string>>;
  handleDeleteAccount: () => Promise<void>;
};

/**
 * Holds the delete account dialog state and performs the delete.
 *
 * @returns The dialog state, its setters and handleDeleteAccount().
 */
export function useDeleteAccount(): AccountDeletion {
  // -------------------------------------------------------------------------
  // Section 6: Account deletion
  // -------------------------------------------------------------------------
  const [showDeleteDialog, setShowDeleteDialog]   = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState('');

  /**
   * Permanently deletes the account via DELETE /api/account.
   * Only runs when the user has typed "DELETE" exactly.
   * Redirects to /register after success.
   */
  async function handleDeleteAccount(): Promise<void> {
    if (deleteConfirmText !== 'DELETE') return;

    setIsDeletingAccount(true);
    setDeleteAccountError('');

    try {
      const res = await fetch('/api/account', { method: 'DELETE' });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setDeleteAccountError(data.error ?? 'Failed to delete account. Please try again.');
        return;
      }

      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full page load drops the deleted account's client state
      window.location.href = '/register';
    } catch {
      setDeleteAccountError('Something went wrong. Please check your connection.');
    } finally {
      setIsDeletingAccount(false);
    }
  }

  return {
    showDeleteDialog,
    setShowDeleteDialog,
    deleteConfirmText,
    setDeleteConfirmText,
    isDeletingAccount,
    deleteAccountError,
    setDeleteAccountError,
    handleDeleteAccount,
  };
}
