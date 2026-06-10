/**
 * app/auth/reset-password/page.tsx
 *
 * Password reset step 2 — set a new password.
 *
 * By the time the user reaches this page the PKCE code exchange has already
 * happened server-side in app/api/auth/callback/route.ts and the session is
 * stored in cookies. This page only needs to:
 *
 *   1. Check that an active session exists (getSession).
 *   2. If yes — show the new-password form.
 *   3. On submit — call updateUser({ password }).
 *   4. On success — redirect to /dashboard.
 *   5. If no session (link expired, already used, or ?error=1 from the callback)
 *      — show an error with a link back to /login.
 *
 * "Back to sign in" signs the user out first so the active session does not
 * cause the middleware to redirect /login → /dashboard.
 */

'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Possible states for the session verification step. */
type ExchangeStatus = 'loading' | 'ready' | 'error';

/** Possible states for the password update form. */
type FormStatus = 'idle' | 'submitting' | 'error' | 'success';

/**
 * ResetPasswordPage checks for an active session (established by the
 * server-side callback route) and renders the new-password form.
 *
 * @returns The reset password page JSX.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [exchangeStatus, setExchangeStatus] = useState<ExchangeStatus>('loading');
  const [exchangeError,  setExchangeError]  = useState<string>('');

  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword,    setShowPassword]    = useState(false);
  const [showConfirm,     setShowConfirm]     = useState(false);
  const [fieldError,      setFieldError]      = useState<string>('');
  const [formStatus,      setFormStatus]      = useState<FormStatus>('idle');
  const [formError,       setFormError]       = useState<string>('');

  /**
   * On mount, check whether the server-side callback successfully established
   * a session. If the callback set ?error=1 in the URL, or if there is no
   * session in cookies, show an error immediately.
   */
  useEffect(() => {
    async function checkSession() {
      // ?error=1 means the server-side code exchange failed (expired or reused link).
      const params = new URLSearchParams(window.location.search);
      if (params.get('error')) {
        setExchangeError(
          'This reset link has expired or has already been used. Please request a new one.'
        );
        setExchangeStatus('error');
        return;
      }

      // The session should already be in cookies from the callback redirect.
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error || !session) {
        setExchangeError(
          'No active session found. Please use the link from your password reset email.'
        );
        setExchangeStatus('error');
        return;
      }

      setExchangeStatus('ready');
    }

    checkSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Validates the two password fields.
   *
   * @param pw - The new password.
   * @param confirm - The confirmation value.
   * @returns A human-readable error string, or null if valid.
   */
  function validate(pw: string, confirm: string): string | null {
    if (!pw) return 'Please enter a new password.';
    if (pw.length < 8) return 'Password must be at least 8 characters.';
    if (!confirm) return 'Please confirm your new password.';
    if (pw !== confirm) return 'Passwords do not match.';
    return null;
  }

  /**
   * Submits the new password via updateUser, then redirects to /dashboard.
   *
   * @param e - The form submit event.
   */
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const validationError = validate(password, confirmPassword);
    if (validationError) {
      setFieldError(validationError);
      return;
    }

    setFieldError('');
    setFormStatus('submitting');
    setFormError('');

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        console.error('[reset-password] updateUser failed:', error.message);
        setFormStatus('error');
        setFormError(
          'Could not update your password. Please try again or request a new reset link.'
        );
        return;
      }

      setFormStatus('success');
      setTimeout(() => router.push('/dashboard'), 1200);
    } catch {
      setFormStatus('error');
      setFormError('Something went wrong. Please check your connection and try again.');
    }
  }

  /**
   * Signs the user out then navigates to /login.
   * Without signing out, the active session causes the middleware to redirect
   * /login → /dashboard.
   */
  async function handleBackToSignIn() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  const isSubmitting = formStatus === 'submitting';

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4"
      style={{
        backgroundColor: '#FAFAF8',
        backgroundImage: 'radial-gradient(circle, #D8D4CC 1px, transparent 1px)',
        backgroundSize: '28px 28px',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-md"
      >
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="flex justify-center mb-2">
            <Image src="/Logo.png" alt="Noshowly" width={200} height={50} className="h-16 w-auto" />
          </div>
          <p className="mt-2 text-sm text-[#8A8680] font-body font-medium tracking-wide uppercase">
            Appointment Reminders
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E2DB] p-8 shadow-sm">

          {/* LOADING */}
          {exchangeStatus === 'loading' && (
            <div className="text-center py-6">
              <div className="w-8 h-8 border-2 border-[#E5E2DB] border-t-[#1B4332] rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm text-[#8A8680] font-body">Verifying your reset link...</p>
            </div>
          )}

          {/* ERROR */}
          {exchangeStatus === 'error' && (
            <div className="text-center py-4">
              <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg
                  className="w-5 h-5 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>
              <h2 className="font-heading text-xl font-bold text-[#1A1A1A] mb-2">
                Link unavailable
              </h2>
              <p className="text-sm text-[#8A8680] font-body mb-6">{exchangeError}</p>
              <button
                type="button"
                onClick={handleBackToSignIn}
                className="inline-flex items-center justify-center w-full h-11 bg-[#1B4332] hover:bg-[#16392A] text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Back to sign in
              </button>
            </div>
          )}

          {/* SUCCESS */}
          {formStatus === 'success' && (
            <div className="text-center py-4">
              <div className="w-10 h-10 bg-[#E8F2EC] rounded-full flex items-center justify-center mx-auto mb-3">
                <svg
                  className="w-5 h-5 text-[#1B4332]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="font-heading text-xl font-bold text-[#1A1A1A] mb-2">
                Password updated
              </h2>
              <p className="text-sm text-[#8A8680] font-body">Redirecting you to your dashboard...</p>
            </div>
          )}

          {/* FORM */}
          {exchangeStatus === 'ready' && formStatus !== 'success' && (
            <>
              <h2 className="font-heading text-2xl font-bold text-[#1A1A1A] mb-1">
                Set new password
              </h2>
              <p className="text-sm text-[#8A8680] font-body mb-7">
                Choose a strong password for your account.
              </p>

              <form onSubmit={handleSubmit} noValidate className="space-y-5">

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-sm font-medium text-[#1A1A1A]">
                    New password
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      disabled={isSubmitting}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (fieldError) setFieldError('');
                      }}
                      placeholder="At least 8 characters"
                      className="h-11 pr-10 border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((v) => !v)}
                      tabIndex={-1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A8680] hover:text-[#1B4332] transition-colors"
                    >
                      {showPassword
                        ? <Eye    className="h-4 w-4" aria-hidden="true" />
                        : <EyeOff className="h-4 w-4" aria-hidden="true" />
                      }
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password" className="text-sm font-medium text-[#1A1A1A]">
                    Confirm password
                  </Label>
                  <div className="relative">
                    <Input
                      id="confirm-password"
                      type={showConfirm ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      disabled={isSubmitting}
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        if (fieldError) setFieldError('');
                      }}
                      placeholder="Repeat your new password"
                      className="h-11 pr-10 border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
                    />
                    <button
                      type="button"
                      aria-label={showConfirm ? 'Hide password' : 'Show password'}
                      onClick={() => setShowConfirm((v) => !v)}
                      tabIndex={-1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A8680] hover:text-[#1B4332] transition-colors"
                    >
                      {showConfirm
                        ? <Eye    className="h-4 w-4" aria-hidden="true" />
                        : <EyeOff className="h-4 w-4" aria-hidden="true" />
                      }
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {(fieldError || formStatus === 'error') && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      role="alert"
                      className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700"
                    >
                      {fieldError || formError}
                    </motion.div>
                  )}
                </AnimatePresence>

                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-11 bg-[#1B4332] hover:bg-[#16392A] text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {isSubmitting ? 'Updating password...' : 'Update password'}
                </Button>

              </form>
            </>
          )}

        </div>

        {/* Bottom back-link */}
        {exchangeStatus !== 'loading' && formStatus !== 'success' && (
          <p className="mt-7 text-center text-sm text-[#8A8680] font-body">
            <button
              type="button"
              onClick={handleBackToSignIn}
              className="font-medium text-[#1B4332] underline underline-offset-4 hover:text-[#16392A]"
            >
              Back to sign in
            </button>
          </p>
        )}
      </motion.div>
    </main>
  );
}
