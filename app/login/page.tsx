/**
 * app/login/page.tsx
 *
 * Premium login page for Noshowly business owners.
 *
 * Features:
 *  - Email + password sign-in via Supabase Auth.
 *  - Show/hide password toggle (lucide-react Eye / EyeOff icons).
 *  - "Forgot password?" inline flow: shows an email input and calls
 *    supabase.auth.resetPasswordForEmail(). Displays a success message
 *    after sending and handles errors gracefully.
 *
 * Security:
 *  - Raw Supabase error messages are never surfaced (prevents user enumeration).
 *  - Password reset success message is shown regardless of whether the email
 *    exists — prevents leaking which emails are registered.
 *  - Form is disabled while submitting to prevent duplicate submissions.
 */

'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Shape of the sign-in form's local state. */
interface LoginFormState {
  email: string;
  password: string;
}

/** Possible UI states for the sign-in form. */
type FormStatus = 'idle' | 'loading' | 'error';

/** Possible UI states for the forgot-password flow. */
type ResetStatus = 'idle' | 'loading' | 'success' | 'error';

/**
 * LoginPage renders a centered, premium email + password sign-in form.
 * Includes show/hide password and a forgot-password reset flow.
 *
 * @returns The login page JSX.
 */
export default function LoginPage() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  // ----- Sign-in form state -----
  const [form, setForm] = useState<LoginFormState>({ email: '', password: '' });
  const [status, setStatus] = useState<FormStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [showPassword, setShowPassword] = useState(false);

  // ----- Forgot-password flow state -----
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetStatus, setResetStatus] = useState<ResetStatus>('idle');
  const [resetError, setResetError] = useState<string>('');

  /**
   * Updates a single sign-in form field and clears any displayed error.
   *
   * @param field - The field name to update.
   * @param value - The new value.
   */
  function handleChange(field: keyof LoginFormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (status === 'error') {
      setStatus('idle');
      setErrorMessage('');
    }
  }

  /**
   * Validates sign-in form fields before submitting.
   *
   * @param email - Email value to validate.
   * @param password - Password value to validate.
   * @returns A human-readable error string, or null if inputs are valid.
   */
  function validate(email: string, password: string): string | null {
    if (!email.trim()) return 'Email is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return 'Please enter a valid email address.';
    }
    if (!password) return 'Password is required.';
    if (password.length < 6) return 'Password must be at least 6 characters.';
    return null;
  }

  /**
   * Handles sign-in form submission: validates, calls Supabase, redirects on success.
   *
   * @param e - The form submit event.
   */
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const { email, password } = form;
    const validationError = validate(email, password);
    if (validationError) {
      setStatus('error');
      setErrorMessage(validationError);
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        // Security: never surface raw Supabase error messages — prevents
        // enumeration attacks where error wording reveals if an email exists.
        setStatus('error');
        setErrorMessage('Invalid email or password. Please try again.');
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      setStatus('error');
      setErrorMessage('Something went wrong. Please check your connection and try again.');
    }
  }

  /**
   * Opens the forgot-password panel and pre-fills the email if already typed.
   */
  function openResetPanel() {
    setResetEmail(form.email);
    setResetStatus('idle');
    setResetError('');
    setShowReset(true);
  }

  /**
   * Closes the forgot-password panel and resets its state.
   */
  function closeResetPanel() {
    setShowReset(false);
    setResetStatus('idle');
    setResetError('');
  }

  /**
   * Sends a password reset email via Supabase Auth.
   *
   * Security: always shows the same success message regardless of whether the
   * email exists — prevents leaking which email addresses are registered.
   *
   * @param e - The form submit event.
   */
  async function handleResetSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const email = resetEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setResetError('Please enter a valid email address.');
      return;
    }

    setResetStatus('loading');
    setResetError('');

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        // Redirect to the server-side callback which exchanges the PKCE code
        // using the cookie-stored verifier, then forwards to reset-password.
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback?next=/auth/reset-password`,
      });

      if (error) {
        // Only surface a generic error — do not reveal whether the email exists.
        console.error('[login/reset] Password reset error:', error.message);
        setResetError('Could not send the reset email. Please try again.');
        setResetStatus('error');
        return;
      }

      // Always show success — even if email doesn't exist, to prevent enumeration.
      setResetStatus('success');
    } catch {
      setResetError('Something went wrong. Please check your connection and try again.');
      setResetStatus('error');
    }
  }

  const isLoading = status === 'loading';

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 py-12"
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

        {/* ----------------------------------------------------------------
            SIGN-IN CARD
        ---------------------------------------------------------------- */}
        <div className="bg-white rounded-2xl border border-[#E5E2DB] p-8 shadow-sm">
          <h2 className="font-heading text-2xl font-bold text-[#1A1A1A] mb-1">
            Welcome back
          </h2>
          <p className="text-sm text-[#8A8680] font-body mb-7">
            Sign in to your dashboard.
          </p>

          <form onSubmit={handleSubmit} noValidate className="space-y-5">

            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium text-[#1A1A1A]">
                Email address
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                disabled={isLoading}
                value={form.email}
                onChange={(e) => handleChange('email', e.target.value)}
                placeholder="you@example.com"
                className="h-11 border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-medium text-[#1A1A1A]">
                  Password
                </Label>
                <button
                  type="button"
                  onClick={openResetPanel}
                  className="text-xs text-[#8A8680] hover:text-[#1B4332] transition-colors"
                >
                  Forgot password?
                </button>
              </div>

              {/* Password input with show/hide toggle */}
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  disabled={isLoading}
                  value={form.password}
                  onChange={(e) => handleChange('password', e.target.value)}
                  placeholder="••••••••"
                  className="h-11 pr-10 border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A]"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A8680] hover:text-[#1B4332] transition-colors"
                >
                  {/* Hidden → EyeOff (password not visible). Visible → Eye (password visible). */}
                  {showPassword
                    ? <Eye    className="h-4 w-4" aria-hidden="true" />
                    : <EyeOff className="h-4 w-4" aria-hidden="true" />
                  }
                </button>
              </div>
            </div>

            {/* Sign-in error */}
            <AnimatePresence>
              {status === 'error' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  role="alert"
                  className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700"
                >
                  {errorMessage}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit */}
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 bg-[#1B4332] hover:bg-[#16392A] text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {isLoading ? 'Signing in…' : 'Sign in'}
            </Button>

          </form>

          {/* ----------------------------------------------------------------
              FORGOT PASSWORD PANEL — slides in below the form
          ---------------------------------------------------------------- */}
          <AnimatePresence>
            {showReset && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="mt-6 pt-6 border-t border-[#E5E2DB]">
                  {resetStatus === 'success' ? (
                    /* Success state */
                    <div className="text-center">
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
                      <p className="text-sm font-medium text-[#1A1A1A] mb-1">Check your email</p>
                      <p className="text-xs text-[#8A8680] font-body mb-4">
                        If an account exists for {resetEmail}, we sent a password reset link.
                      </p>
                      <button
                        type="button"
                        onClick={closeResetPanel}
                        className="text-xs font-medium text-[#1B4332] underline underline-offset-4 hover:text-[#16392A] font-body"
                      >
                        Back to sign in
                      </button>
                    </div>
                  ) : (
                    /* Input state */
                    <form onSubmit={handleResetSubmit} noValidate className="space-y-4">
                      <div>
                        <p className="text-sm font-medium text-[#1A1A1A] mb-0.5">Reset your password</p>
                        <p className="text-xs text-[#8A8680] font-body">
                          Enter your email and we will send a reset link.
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="reset-email" className="text-sm font-medium text-[#1A1A1A]">
                          Email address
                        </Label>
                        <Input
                          id="reset-email"
                          type="email"
                          autoComplete="email"
                          disabled={resetStatus === 'loading'}
                          value={resetEmail}
                          onChange={(e) => {
                            setResetEmail(e.target.value);
                            if (resetError) setResetError('');
                          }}
                          placeholder="you@example.com"
                          className="h-11 border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
                        />
                      </div>

                      {/* Reset error */}
                      <AnimatePresence>
                        {resetError && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            role="alert"
                            className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700"
                          >
                            {resetError}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div className="flex items-center gap-3">
                        <Button
                          type="submit"
                          disabled={resetStatus === 'loading'}
                          className="flex-1 h-10 bg-[#1B4332] hover:bg-[#16392A] text-white text-sm font-semibold rounded-lg transition-colors"
                        >
                          {resetStatus === 'loading' ? 'Sending…' : 'Send reset link'}
                        </Button>
                        <button
                          type="button"
                          onClick={closeResetPanel}
                          className="text-sm text-[#8A8680] hover:text-[#1B4332] transition-colors font-body"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>

        {/* Register link */}
        <p className="mt-7 text-center text-sm text-[#8A8680] font-body">
          Don&apos;t have an account?{' '}
          <Link
            href="/register"
            className="font-medium text-[#1B4332] underline underline-offset-4 hover:text-[#16392A]"
          >
            Sign up
          </Link>
        </p>

        {/* Demo account hint */}
        <div className="mt-4 text-center">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-px flex-1 bg-[#E5E2DB]" />
            <span className="text-xs text-[#8A8680] font-body">or</span>
            <div className="h-px flex-1 bg-[#E5E2DB]" />
          </div>
          <p className="text-xs text-[#8A8680] font-body mb-1">Want to explore the app?</p>
          <button
            type="button"
            onClick={() => {
              setForm({ email: 'demo@noshowly.com', password: 'Demo1234!' });
              setStatus('idle');
              setErrorMessage('');
            }}
            className="text-xs font-medium text-[#1B4332] underline underline-offset-4 hover:text-[#16392A] font-body transition-colors"
          >
            Use demo account
          </button>
        </div>
      </motion.div>
    </main>
  );
}
