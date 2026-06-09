/**
 * app/auth/reset-password/page.tsx
 *
 * Password reset — step 2: set a new password.
 *
 * Root cause of "No reset token found":
 *   The Supabase browser client's initialize() calls _getSessionFromUrl()
 *   asynchronously on startup. When it detects a recovery hash it processes
 *   the tokens and then calls history.replaceState to strip the hash from the
 *   URL — all before our useEffect runs. By the time we read
 *   window.location.hash it is already empty.
 *
 * Fix: capture the hash at module evaluation time (the top-level IIFE below).
 *   Module-level code runs synchronously when the JS bundle is parsed, which
 *   is before React rendering, before Supabase async code, and before any
 *   event listeners fire. We write the raw hash to sessionStorage immediately
 *   so it survives even after the URL is mutated.
 *
 * The useEffect then waits 500 ms (to clear hydration) and reads from:
 *   1. window.location.hash     — still present if Supabase hasn't cleared it
 *   2. sessionStorage           — fallback if Supabase already cleared the URL
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

// ---------------------------------------------------------------------------
// Module-level hash capture
//
// This IIFE runs the moment the JS bundle is evaluated — earlier than any
// React lifecycle, earlier than Supabase's async initialize(), and earlier
// than any event listener. Saving to sessionStorage lets the component
// retrieve the hash even after history.replaceState has cleared the URL.
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  const earlyHash = window.location.hash;
  console.log('[reset-password] module-level capture — hash:', earlyHash);
  if (earlyHash) {
    try {
      sessionStorage.setItem('noshowly_reset_hash', earlyHash);
    } catch {
      // sessionStorage unavailable (some private-mode browsers)
    }
  }
}

/** Possible states for the initial token verification step. */
type ExchangeStatus = 'loading' | 'ready' | 'error';

/** Possible states for the password update form. */
type FormStatus = 'idle' | 'submitting' | 'error' | 'success';

/**
 * ResetPasswordPage captures the Supabase recovery hash, establishes a
 * session via setSession(), then lets the user set a new password.
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

  useEffect(() => {
    // Also try to save the hash via the load event in case we got here before
    // the window load event fired.
    function saveHashOnLoad() {
      const h = window.location.hash;
      if (h) {
        try { sessionStorage.setItem('noshowly_reset_hash', h); } catch { /* ignore */ }
      }
    }

    if (document.readyState === 'complete') {
      saveHashOnLoad();
    } else {
      window.addEventListener('load', saveHashOnLoad, { once: true });
    }

    // Wait 500 ms to ensure Next.js hydration and any Supabase async init are
    // complete before we read the token.
    const timer = setTimeout(() => { void processToken(); }, 500);

    async function processToken() {
      // ------------------------------------------------------------------
      // Diagnostic logging — paste this into the bug report
      // ------------------------------------------------------------------
      console.log('[reset-password] window.location.href   :', window.location.href);
      console.log('[reset-password] window.location.hash   :', window.location.hash);
      console.log('[reset-password] window.location.search :', window.location.search);

      let storedHash = '';
      try { storedHash = sessionStorage.getItem('noshowly_reset_hash') ?? ''; } catch { /* ignore */ }
      console.log('[reset-password] sessionStorage hash     :', storedHash);

      // ------------------------------------------------------------------
      // Determine which hash to use
      // ------------------------------------------------------------------
      const liveHash = window.location.hash;
      const rawHash  = liveHash || storedHash;
      console.log('[reset-password] using hash              :', rawHash);

      // ------------------------------------------------------------------
      // Attempt 1 — implicit flow: hash contains access_token
      // ------------------------------------------------------------------
      if (rawHash) {
        const stripped = rawHash.startsWith('#') ? rawHash.substring(1) : rawHash;
        const params   = new URLSearchParams(stripped);

        const accessToken  = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        const type         = params.get('type');

        console.log('[reset-password] hash params:', {
          hasAccessToken:  !!accessToken,
          hasRefreshToken: !!refreshToken,
          type,
        });

        if (accessToken && refreshToken) {
          if (type !== 'recovery') {
            console.warn('[reset-password] hash type is not recovery:', type);
            setExchangeError('This link is not a password reset link. Please request a new one.');
            setExchangeStatus('error');
            return;
          }

          console.log('[reset-password] calling setSession()');
          const { data, error } = await supabase.auth.setSession({
            access_token:  accessToken,
            refresh_token: refreshToken,
          });
          console.log('[reset-password] setSession result:', { session: !!data.session, error });

          // Clear sessionStorage after a successful (or failed) use so a
          // stale hash cannot be replayed on a future visit.
          try { sessionStorage.removeItem('noshowly_reset_hash'); } catch { /* ignore */ }

          if (error) {
            setExchangeError('This reset link has expired or has already been used. Please request a new one.');
            setExchangeStatus('error');
            return;
          }

          setExchangeStatus('ready');
          return;
        }
      }

      // ------------------------------------------------------------------
      // Attempt 2 — PKCE flow: ?code= in the query string
      // ------------------------------------------------------------------
      const code = new URLSearchParams(window.location.search).get('code');
      console.log('[reset-password] PKCE code present:', !!code);

      if (code) {
        console.log('[reset-password] calling exchangeCodeForSession()');
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        console.log('[reset-password] exchangeCodeForSession result:', { session: !!data.session, error });

        if (error) {
          setExchangeError('This reset link has expired or has already been used. Please request a new one.');
          setExchangeStatus('error');
          return;
        }

        setExchangeStatus('ready');
        return;
      }

      // ------------------------------------------------------------------
      // Nothing found
      // ------------------------------------------------------------------
      console.warn('[reset-password] no token in hash or query string');
      setExchangeError('No reset token found. Please use the link from your password reset email.');
      setExchangeStatus('error');
    }

    return () => {
      clearTimeout(timer);
      window.removeEventListener('load', saveHashOnLoad);
    };
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
        setFormError('Could not update your password. Please try again or request a new reset link.');
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
   * setSession() establishes a real session; without signing out the middleware
   * redirects /login to /dashboard.
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

          {/* LOADING */}
          {exchangeStatus === 'loading' && (
            <div className="text-center py-6">
              <div className="w-8 h-8 border-2 border-[#1A1A1A]/20 border-t-[#1A1A1A] rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm text-[#C8C8C8]">Verifying your reset link...</p>
            </div>
          )}

          {/* ERROR */}
          {exchangeStatus === 'error' && (
            <div className="text-center py-4">
              <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
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

          {/* SUCCESS */}
          {formStatus === 'success' && (
            <div className="text-center py-4">
              <div className="w-10 h-10 bg-[#1A1A1A]/5 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-5 h-5 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="font-heading text-xl font-semibold text-[#1A1A1A] mb-2">Password updated</h2>
              <p className="text-sm text-[#C8C8C8]">Redirecting you to your dashboard...</p>
            </div>
          )}

          {/* FORM */}
          {exchangeStatus === 'ready' && formStatus !== 'success' && (
            <>
              <h2 className="font-heading text-2xl font-semibold text-[#1A1A1A] mb-1">
                Set new password
              </h2>
              <p className="text-sm text-[#C8C8C8] mb-7">
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
                      onChange={(e) => { setPassword(e.target.value); if (fieldError) setFieldError(''); }}
                      placeholder="At least 8 characters"
                      className="h-11 pr-10 border-[#C8C8C8] focus-visible:border-[#1A1A1A] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#C8C8C8]"
                    />
                    <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((v) => !v)} tabIndex={-1} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors">
                      {showPassword ? <Eye className="h-4 w-4" aria-hidden="true" /> : <EyeOff className="h-4 w-4" aria-hidden="true" />}
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
                      onChange={(e) => { setConfirmPassword(e.target.value); if (fieldError) setFieldError(''); }}
                      placeholder="Repeat your new password"
                      className="h-11 pr-10 border-[#C8C8C8] focus-visible:border-[#1A1A1A] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#C8C8C8]"
                    />
                    <button type="button" aria-label={showConfirm ? 'Hide password' : 'Show password'} onClick={() => setShowConfirm((v) => !v)} tabIndex={-1} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors">
                      {showConfirm ? <Eye className="h-4 w-4" aria-hidden="true" /> : <EyeOff className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {(fieldError || formStatus === 'error') && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} role="alert" className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
                      {fieldError || formError}
                    </motion.div>
                  )}
                </AnimatePresence>

                <Button type="submit" disabled={isSubmitting} className="w-full h-11 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-lg transition-colors">
                  {isSubmitting ? 'Updating password...' : 'Update password'}
                </Button>

              </form>
            </>
          )}

        </div>

        {exchangeStatus !== 'loading' && formStatus !== 'success' && (
          <p className="mt-7 text-center text-sm text-[#C8C8C8]">
            <button type="button" onClick={handleBackToSignIn} className="font-medium text-[#1A1A1A] underline underline-offset-4 hover:text-[#2D2D2D]">
              Back to sign in
            </button>
          </p>
        )}
      </motion.div>
    </main>
  );
}
