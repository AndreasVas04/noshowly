/**
 * app/auth/reset-password/page.tsx
 *
 * Handles the second half of the password reset flow.
 *
 * How Supabase password reset works in production:
 *   1. User clicks the reset link in their email.
 *   2. Supabase redirects to this page with the token in the URL fragment
 *      (e.g. #access_token=...&type=recovery). The fragment is never sent to
 *      the server — it is processed entirely by the Supabase JS client on load.
 *   3. The JS client emits a PASSWORD_RECOVERY auth event, which we listen for
 *      via onAuthStateChange. When it fires, we show the new-password form.
 *   4. After updateUser() succeeds, we redirect to /dashboard.
 *
 * Why onAuthStateChange instead of reading URL params:
 *   The default Supabase production flow puts the token in the URL hash (#),
 *   not the query string (?). Query params like ?code or ?token_hash are only
 *   present for specific flow configurations. The onAuthStateChange approach
 *   handles all flows correctly.
 *
 * Security:
 *  - Tokens are single-use and expire after a short window.
 *  - Session is established by the Supabase client before the form is shown.
 *  - Raw Supabase errors are never surfaced verbatim.
 *  - "Back to sign in" signs the user out first to prevent middleware
 *    redirecting them to /dashboard when they are still in a recovery session.
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

/** Possible states for the initial token verification. */
type ExchangeStatus = 'loading' | 'ready' | 'error';

/** Possible states for the password update form. */
type FormStatus = 'idle' | 'submitting' | 'error' | 'success';

/** How long to wait for the PASSWORD_RECOVERY event before showing an error (ms). */
const RECOVERY_TIMEOUT_MS = 8000;

/**
 * ResetPasswordPage listens for the Supabase PASSWORD_RECOVERY auth event and
 * then renders a form for the user to set their new password.
 *
 * @returns The reset password page JSX.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [exchangeStatus, setExchangeStatus] = useState<ExchangeStatus>('loading');
  const [exchangeError, setExchangeError] = useState<string>('');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [fieldError, setFieldError] = useState<string>('');
  const [formStatus, setFormStatus] = useState<FormStatus>('idle');
  const [formError, setFormError] = useState<string>('');

  /**
   * Subscribes to Supabase auth state changes on mount.
   *
   * When the user lands on this page via a password reset email link, the
   * Supabase JS client processes the URL hash and emits a PASSWORD_RECOVERY
   * event. We listen for that event and show the form once it fires.
   *
   * A timeout guard shows an error if no event fires within RECOVERY_TIMEOUT_MS,
   * which handles expired links and users who navigate to this URL directly.
   */
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setExchangeStatus('ready');
      }
    });

    // Fallback: if PASSWORD_RECOVERY never fires within the timeout window,
    // the link is expired, already used, or the user navigated here directly.
    const timeout = setTimeout(() => {
      setExchangeStatus((current) => {
        if (current === 'loading') {
          setExchangeError(
            'This reset link has expired or has already been used. Please request a new one.'
          );
          return 'error';
        }
        return current;
      });
    }, RECOVERY_TIMEOUT_MS);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Validates the two password fields before submission.
   *
   * @param pw - The new password value.
   * @param confirm - The confirm password value.
   * @returns A human-readable error string, or null if inputs are valid.
   */
  function validate(pw: string, confirm: string): string | null {
    if (!pw) return 'Please enter a new password.';
    if (pw.length < 8) return 'Password must be at least 8 characters.';
    if (!confirm) return 'Please confirm your new password.';
    if (pw !== confirm) return 'Passwords do not match.';
    return null;
  }

  /**
   * Submits the new password via Supabase updateUser, then redirects to /dashboard.
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
      // Short delay so the success state is visible before navigating.
      setTimeout(() => router.push('/dashboard'), 1200);
    } catch {
      setFormStatus('error');
      setFormError('Something went wrong. Please check your connection and try again.');
    }
  }

  /**
   * Signs the user out before navigating to /login.
   *
   * This is necessary because clicking the reset link establishes a Supabase
   * session. Without signing out first, the middleware would detect the active
   * session and redirect /login to /dashboard instead of showing the sign-in form.
   */
  async function handleBackToSignIn() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  const isSubmitting = formStatus === 'submitting';

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#F9F9F9] px-4">
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
          <p className="mt-2 text-sm text-[#C8C8C8] font-medium tracking-wide uppercase">
            Appointment Reminders
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-[#C8C8C8]/40 p-8 shadow-sm">

          {/* ------------------------------------------------------------
              LOADING — waiting for the PASSWORD_RECOVERY event
          ------------------------------------------------------------ */}
          {exchangeStatus === 'loading' && (
            <div className="text-center py-6">
              <div className="w-8 h-8 border-2 border-[#1A1A1A]/20 border-t-[#1A1A1A] rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm text-[#C8C8C8]">Verifying your reset link...</p>
            </div>
          )}

          {/* ------------------------------------------------------------
              EXCHANGE ERROR — expired / already used / no token found
          ------------------------------------------------------------ */}
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
              <h2 className="font-heading text-xl font-semibold text-[#1A1A1A] mb-2">
                Link unavailable
              </h2>
              <p className="text-sm text-[#C8C8C8] mb-6">{exchangeError}</p>
              <button
                type="button"
                onClick={handleBackToSignIn}
                className="inline-block w-full h-11 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Back to sign in
              </button>
            </div>
          )}

          {/* ------------------------------------------------------------
              SUCCESS — password updated
          ------------------------------------------------------------ */}
          {formStatus === 'success' && (
            <div className="text-center py-4">
              <div className="w-10 h-10 bg-[#1A1A1A]/5 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg
                  className="w-5 h-5 text-[#1A1A1A]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="font-heading text-xl font-semibold text-[#1A1A1A] mb-2">
                Password updated
              </h2>
              <p className="text-sm text-[#C8C8C8]">Redirecting you to your dashboard...</p>
            </div>
          )}

          {/* ------------------------------------------------------------
              FORM — shown once the PASSWORD_RECOVERY event fires
          ------------------------------------------------------------ */}
          {exchangeStatus === 'ready' && formStatus !== 'success' && (
            <>
              <h2 className="font-heading text-2xl font-semibold text-[#1A1A1A] mb-1">
                Set new password
              </h2>
              <p className="text-sm text-[#C8C8C8] mb-7">
                Choose a strong password for your account.
              </p>

              <form onSubmit={handleSubmit} noValidate className="space-y-5">

                {/* New password */}
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
                      className="h-11 pr-10 border-[#C8C8C8] focus-visible:border-[#1A1A1A] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#C8C8C8]"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((v) => !v)}
                      tabIndex={-1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors"
                    >
                      {showPassword ? (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Confirm password */}
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
                      className="h-11 pr-10 border-[#C8C8C8] focus-visible:border-[#1A1A1A] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#C8C8C8]"
                    />
                    <button
                      type="button"
                      aria-label={showConfirm ? 'Hide password' : 'Show password'}
                      onClick={() => setShowConfirm((v) => !v)}
                      tabIndex={-1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors"
                    >
                      {showConfirm ? (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Validation / API error */}
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
                  className="w-full h-11 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {isSubmitting ? 'Updating password...' : 'Update password'}
                </Button>

              </form>
            </>
          )}

        </div>

        {/* Back to sign in — only shown when not in the loading or success states */}
        {exchangeStatus !== 'loading' && formStatus !== 'success' && (
          <p className="mt-7 text-center text-sm text-[#C8C8C8]">
            <button
              type="button"
              onClick={handleBackToSignIn}
              className="font-medium text-[#1A1A1A] underline underline-offset-4 hover:text-[#2D2D2D]"
            >
              Back to sign in
            </button>
          </p>
        )}
      </motion.div>
    </main>
  );
}
