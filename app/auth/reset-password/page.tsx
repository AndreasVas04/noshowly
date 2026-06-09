/**
 * app/auth/reset-password/page.tsx
 *
 * Handles the password reset flow — second half (setting the new password).
 *
 * Two flows are supported because Supabase project settings control which one
 * is used:
 *
 *   Hash flow (implicit):  /auth/reset-password#access_token=xxx&refresh_token=xxx&type=recovery
 *     → parse window.location.hash, call setSession({ access_token, refresh_token })
 *
 *   PKCE flow:             /auth/reset-password?code=xxx
 *     → read ?code query param, call exchangeCodeForSession(code)
 *
 * Debug logging is intentionally left in so that the exact URL, tokens, and
 * Supabase responses can be inspected in the browser console.
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

/** Possible states for the initial token verification step. */
type ExchangeStatus = 'loading' | 'ready' | 'error';

/** Possible states for the password update form. */
type FormStatus = 'idle' | 'submitting' | 'error' | 'success';

/**
 * ResetPasswordPage detects which reset flow Supabase used, establishes a
 * session from the token, then lets the user set a new password.
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
   * On mount, determine which Supabase reset flow is in use and attempt to
   * establish a session. Logs everything to the browser console for debugging.
   *
   * Priority:
   *   1. Hash fragment contains access_token → implicit/hash flow → setSession()
   *   2. Query string contains code= → PKCE flow → exchangeCodeForSession()
   *   3. Neither → show error
   */
  useEffect(() => {
    async function processToken() {
      // -----------------------------------------------------------------------
      // Log the raw URL so we can see exactly what Supabase sent.
      // -----------------------------------------------------------------------
      console.log('[reset-password] href  :', window.location.href);
      console.log('[reset-password] hash  :', window.location.hash);
      console.log('[reset-password] search:', window.location.search);

      const hashRaw   = window.location.hash.substring(1);   // strip leading '#'
      const hashParams  = new URLSearchParams(hashRaw);
      const searchParams = new URLSearchParams(window.location.search);

      console.log('[reset-password] hash params:', Object.fromEntries(hashParams.entries()));
      console.log('[reset-password] search params:', Object.fromEntries(searchParams.entries()));

      const accessToken  = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      const hashType     = hashParams.get('type');
      const code         = searchParams.get('code');

      console.log('[reset-password] flow detection →', {
        hasHashAccessToken: !!accessToken,
        hasHashRefreshToken: !!refreshToken,
        hashType,
        hasCode: !!code,
      });

      // -----------------------------------------------------------------------
      // FLOW 1 — Hash fragment with access_token (implicit / hash flow)
      // -----------------------------------------------------------------------
      if (accessToken && refreshToken) {
        console.log('[reset-password] using hash flow → calling setSession()');

        if (hashType !== 'recovery') {
          console.warn('[reset-password] hash type is not "recovery":', hashType);
          setExchangeError(
            'This link is not a password reset link. Please request a new password reset email.'
          );
          setExchangeStatus('error');
          return;
        }

        const { data, error } = await supabase.auth.setSession({
          access_token:  accessToken,
          refresh_token: refreshToken,
        });

        console.log('[reset-password] setSession result →', { data, error });

        if (error) {
          setExchangeError(
            'This reset link has expired or has already been used. Please request a new one.'
          );
          setExchangeStatus('error');
          return;
        }

        setExchangeStatus('ready');
        return;
      }

      // -----------------------------------------------------------------------
      // FLOW 2 — Query param ?code= (PKCE flow)
      // -----------------------------------------------------------------------
      if (code) {
        console.log('[reset-password] using PKCE flow → calling exchangeCodeForSession()');

        const { data, error } = await supabase.auth.exchangeCodeForSession(code);

        console.log('[reset-password] exchangeCodeForSession result →', { data, error });

        if (error) {
          setExchangeError(
            'This reset link has expired or has already been used. Please request a new one.'
          );
          setExchangeStatus('error');
          return;
        }

        setExchangeStatus('ready');
        return;
      }

      // -----------------------------------------------------------------------
      // FLOW 3 — Nothing found
      // -----------------------------------------------------------------------
      console.warn('[reset-password] no token found in hash or query string');
      setExchangeError(
        'No reset token found. Please use the link from your password reset email.'
      );
      setExchangeStatus('error');
    }

    processToken();
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
   * Submits the new password and redirects to /dashboard on success.
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
      console.log('[reset-password] calling updateUser()');
      const { data, error } = await supabase.auth.updateUser({ password });
      console.log('[reset-password] updateUser result →', { data, error });

      if (error) {
        setFormStatus('error');
        setFormError(
          'Could not update your password. Please try again or request a new reset link.'
        );
        return;
      }

      setFormStatus('success');
      setTimeout(() => router.push('/dashboard'), 1200);
    } catch (err) {
      console.error('[reset-password] unexpected error in handleSubmit:', err);
      setFormStatus('error');
      setFormError('Something went wrong. Please check your connection and try again.');
    }
  }

  /**
   * Signs the user out before navigating to /login.
   *
   * setSession() / exchangeCodeForSession() establish a real Supabase session.
   * Without signing out, the middleware redirects /login to /dashboard.
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
              LOADING — parsing URL and calling Supabase
          ------------------------------------------------------------ */}
          {exchangeStatus === 'loading' && (
            <div className="text-center py-6">
              <div className="w-8 h-8 border-2 border-[#1A1A1A]/20 border-t-[#1A1A1A] rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm text-[#C8C8C8]">Verifying your reset link...</p>
            </div>
          )}

          {/* ------------------------------------------------------------
              ERROR — bad hash, wrong type, expired, or no token at all
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
                className="inline-flex items-center justify-center w-full h-11 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Back to sign in
              </button>
            </div>
          )}

          {/* ------------------------------------------------------------
              SUCCESS — password updated, redirecting
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
              FORM — shown after session is established
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

        {/* Bottom back-link — hidden during loading and after success */}
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
