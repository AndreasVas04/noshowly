/**
 * app/login/page.tsx
 *
 * Login page for NoShowly.
 *
 * Only the salon owner logs in — end clients (haircut customers) never have accounts.
 * Authentication is handled entirely by Supabase Auth (email + password).
 *
 * On successful login the user is redirected to /dashboard.
 * On failure a user-friendly error message is shown without leaking internals.
 *
 * Security:
 * - Inputs are validated client-side before the Supabase call to avoid unnecessary
 *   network requests, but Supabase also enforces this server-side.
 * - We never display raw Supabase error messages — they may reveal implementation details.
 * - The form is disabled while submitting to prevent duplicate submissions.
 * - Rate limiting for auth attempts is enforced by Supabase on their side.
 */

'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the form's local state. */
interface LoginFormState {
  email: string;
  password: string;
}

/** Possible UI states for the form. */
type FormStatus = 'idle' | 'loading' | 'error';

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

/**
 * LoginPage renders the email + password sign-in form.
 *
 * Flow:
 *  1. User fills in email + password and submits.
 *  2. We validate inputs locally (non-empty, basic email shape).
 *  3. We call Supabase signInWithPassword.
 *  4. On success: router.push('/dashboard') — middleware will verify the session.
 *  5. On failure: show a safe, generic error message.
 *
 * @returns The login page JSX.
 */
export default function LoginPage() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [form, setForm] = useState<LoginFormState>({ email: '', password: '' });
  const [status, setStatus] = useState<FormStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Updates a single form field while keeping the rest intact.
   *
   * @param field - The field name to update ('email' | 'password').
   * @param value - The new value for the field.
   */
  function handleChange(field: keyof LoginFormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Clear any previous error as soon as the user starts typing again
    if (status === 'error') {
      setStatus('idle');
      setErrorMessage('');
    }
  }

  /**
   * Validates form fields before submitting to Supabase.
   * Returns an error string if invalid, or null if valid.
   *
   * @param email - The email value to validate.
   * @param password - The password value to validate.
   * @returns A human-readable error string, or null if inputs are valid.
   */
  function validate(email: string, password: string): string | null {
    if (!email.trim()) return 'Email is required.';
    // Basic email shape check — Supabase enforces the real validation server-side
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return 'Please enter a valid email address.';
    }
    if (!password) return 'Password is required.';
    if (password.length < 6) return 'Password must be at least 6 characters.';
    return null;
  }

  // ---------------------------------------------------------------------------
  // Submit handler
  // ---------------------------------------------------------------------------

  /**
   * Handles form submission: validates inputs, calls Supabase auth,
   * and redirects to /dashboard on success.
   *
   * @param e - The form submit event (prevented to avoid page reload).
   */
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const { email, password } = form;

    // Client-side validation before hitting the network
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
        // Security: do NOT surface raw Supabase error messages — they can leak info.
        // Show a single generic message for all auth failures to prevent user enumeration.
        setStatus('error');
        setErrorMessage('Invalid email or password. Please try again.');
        return;
      }

      // Session cookie is set by Supabase — redirect to dashboard.
      // middleware.ts will verify the session on every /dashboard/* request.
      router.push('/dashboard');
      router.refresh(); // Ensure server components re-render with the new session
    } catch {
      // Network or unexpected error — don't crash, show safe message
      setStatus('error');
      setErrorMessage('Something went wrong. Please check your connection and try again.');
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isLoading = status === 'loading';

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">

        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Noshowly</h1>
          <p className="mt-2 text-sm text-gray-500">Sign in to your salon dashboard</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Welcome back</h2>

          <form onSubmit={handleSubmit} noValidate className="space-y-5">

            {/* Email field */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                disabled={isLoading}
                value={form.email}
                onChange={(e) => handleChange('email', e.target.value)}
                placeholder="you@example.com"
                className="
                  w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900
                  placeholder:text-gray-400
                  focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent
                  disabled:bg-gray-50 disabled:text-gray-400
                  transition
                "
              />
            </div>

            {/* Password field */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-700"
                >
                  Password
                </label>
                {/* Placeholder for future forgot-password flow */}
                <span className="text-xs text-gray-400">Forgot password? Coming soon</span>
              </div>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={isLoading}
                value={form.password}
                onChange={(e) => handleChange('password', e.target.value)}
                placeholder="••••••••"
                className="
                  w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900
                  placeholder:text-gray-400
                  focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent
                  disabled:bg-gray-50 disabled:text-gray-400
                  transition
                "
              />
            </div>

            {/* Error message */}
            {status === 'error' && (
              <div
                role="alert"
                className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
              >
                {errorMessage}
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={isLoading}
              className="
                w-full rounded-lg bg-black text-white text-sm font-medium
                px-4 py-2.5
                hover:bg-gray-800
                focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2
                disabled:opacity-50 disabled:cursor-not-allowed
                transition
              "
            >
              {isLoading ? 'Signing in…' : 'Sign in'}
            </button>

          </form>
        </div>

        {/* Register link */}
        <p className="mt-6 text-center text-sm text-gray-500">
          Don&apos;t have an account?{' '}
          <Link
            href="/register"
            className="font-medium text-black underline underline-offset-4 hover:text-gray-700"
          >
            Start your free trial
          </Link>
        </p>

      </div>
    </main>
  );
}
