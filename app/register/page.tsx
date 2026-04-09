/**
 * app/register/page.tsx
 *
 * Registration page for NoShowly salon owners.
 *
 * Only salon owners register — end clients (haircut customers) never have accounts.
 * New accounts receive a 14-day free trial with no credit card required.
 *
 * Registration flow:
 *  1. User fills in salon name, email, password, and confirm password.
 *  2. Client-side validation runs (fast feedback before any network call).
 *  3. `supabase.auth.signUp()` creates the auth user and sets the session cookie.
 *  4. POST /api/auth/register creates the `users` and `salons` DB records.
 *  5. On success: redirect to /dashboard.
 *  6. If Supabase requires email confirmation (project setting): show "check email" screen.
 *
 * Security:
 *  - Inputs are validated client-side AND server-side (in the API route).
 *  - Raw Supabase error messages are never surfaced to the user — they may reveal
 *    implementation details. The only exception is the "already registered" case,
 *    which is safe and helpful to surface.
 *  - The form is disabled while submitting to prevent duplicate submissions.
 *  - If the API route fails after signUp, the orphaned auth user is signed out so
 *    the owner can retry cleanly.
 *  - Password inputs use autoComplete="new-password" to prevent password managers
 *    from auto-filling with saved credentials.
 */

'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the registration form's local state. */
interface RegisterFormState {
  salonName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

/**
 * Possible UI states for the form.
 * 'success' is used for the email-confirmation-required interstitial screen.
 */
type FormStatus = 'idle' | 'loading' | 'error' | 'success';

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

/**
 * RegisterPage renders the sign-up form for new salon owners.
 *
 * @returns The registration page JSX.
 */
export default function RegisterPage() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [form, setForm] = useState<RegisterFormState>({
    salonName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [status, setStatus] = useState<FormStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Updates a single form field while keeping the rest intact.
   * Also clears any displayed error so the user gets a clean slate as they type.
   *
   * @param field - The field name to update.
   * @param value - The new value for the field.
   */
  function handleChange(field: keyof RegisterFormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Clear error banner as soon as user starts correcting their input
    if (status === 'error') {
      setStatus('idle');
      setErrorMessage('');
    }
  }

  /**
   * Validates all form fields before making any network calls.
   * Returns a human-readable error string on the first failing rule, or null
   * if all fields are valid.
   *
   * Validation is intentionally permissive on the client: the API route and
   * Supabase also validate, so this layer is only for fast user feedback.
   *
   * @param fields - The current form state to validate.
   * @returns A user-facing error string, or null if all inputs are valid.
   */
  function validate(fields: RegisterFormState): string | null {
    const { salonName, email, password, confirmPassword } = fields;

    // Salon name
    if (!salonName.trim()) return 'Salon name is required.';
    if (salonName.trim().length > 100) {
      return 'Salon name must be 100 characters or fewer.';
    }

    // Email — basic shape check; Supabase enforces the real validation server-side
    if (!email.trim()) return 'Email is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return 'Please enter a valid email address.';
    }

    // Password
    if (!password) return 'Password is required.';
    if (password.length < 8) {
      return 'Password must be at least 8 characters.';
    }

    // Confirm password
    if (password !== confirmPassword) {
      return 'Passwords do not match.';
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Submit handler
  // ---------------------------------------------------------------------------

  /**
   * Handles form submission:
   *  1. Validates inputs locally.
   *  2. Calls Supabase signUp (creates the auth user).
   *  3. If a session is returned, calls /api/auth/register to create DB records.
   *  4. Redirects to /dashboard on full success.
   *  5. Shows "check email" screen if Supabase requires email confirmation.
   *
   * @param e - The form submit event (prevented to avoid page reload).
   */
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // Client-side validation — fail fast before hitting the network
    const validationError = validate(form);
    if (validationError) {
      setStatus('error');
      setErrorMessage(validationError);
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      // ------------------------------------------------------------------
      // Step 1: Create the Supabase auth user.
      // This sets the session cookie on success (if email confirmation is off).
      // ------------------------------------------------------------------
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: form.email.trim().toLowerCase(),
        password: form.password,
        options: {
          // Store the salon name in user metadata so the auth callback route can
          // read it and create the `users`/`salons` DB records after email confirmation.
          data: { salon_name: form.salonName.trim() },
          // After the user clicks the confirmation link, Supabase will redirect here.
          // The callback route exchanges the code and creates the DB records.
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (signUpError) {
        // Security: do NOT surface raw Supabase error messages — they may leak
        // information about our auth implementation.
        // The "already registered" case is safe and useful to tell the user.
        const message = signUpError.message.toLowerCase();
        const alreadyRegistered =
          message.includes('already registered') ||
          message.includes('already been registered') ||
          message.includes('user already exists');

        setStatus('error');
        setErrorMessage(
          alreadyRegistered
            ? 'An account with this email already exists. Try signing in instead.'
            : 'Could not create your account. Please try again.'
        );
        return;
      }

      // ------------------------------------------------------------------
      // Step 2: Handle email confirmation requirement.
      // If the Supabase project has "Confirm email" enabled, signUp returns
      // no session until the user clicks their confirmation link.
      // ------------------------------------------------------------------
      if (!signUpData.session) {
        // Show the "check your inbox" interstitial — no further action needed here.
        setStatus('success');
        return;
      }

      // ------------------------------------------------------------------
      // Step 3: Create the `users` and `salons` DB records via API route.
      // The session cookie was just set by signUp — the route will read it.
      // ------------------------------------------------------------------
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonName: form.salonName.trim() }),
      });

      if (!res.ok) {
        // The DB record creation failed. Sign out the orphaned auth user so
        // the owner can attempt registration again from a clean state.
        await supabase.auth.signOut();
        setStatus('error');
        setErrorMessage(
          'Your account was created but setup could not be completed. ' +
            'Please try again or contact support.'
        );
        return;
      }

      // ------------------------------------------------------------------
      // Step 4: All done — redirect to the dashboard.
      // middleware.ts will verify the session on every /dashboard/* request.
      // ------------------------------------------------------------------
      router.push('/dashboard');
      router.refresh(); // Flush server-component cache so layout reads new session
    } catch {
      // Network error or unexpected exception — don't crash, show safe message
      setStatus('error');
      setErrorMessage(
        'Something went wrong. Please check your connection and try again.'
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Email-confirmation-required screen
  // ---------------------------------------------------------------------------

  if (status === 'success') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">

            {/* Checkmark icon */}
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
              <svg
                className="w-6 h-6 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mb-2">Check your email</h2>
            <p className="text-sm text-gray-500 mb-1">
              We sent a confirmation link to:
            </p>
            <p className="text-sm font-medium text-gray-800 mb-4">{form.email}</p>
            <p className="text-sm text-gray-500">
              Click the link in the email to activate your account and get started.
            </p>

          </div>

          <p className="mt-6 text-center text-sm text-gray-500">
            Wrong email?{' '}
            <button
              type="button"
              onClick={() => setStatus('idle')}
              className="font-medium text-black underline underline-offset-4 hover:text-gray-700"
            >
              Go back
            </button>
          </p>
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Main registration form
  // ---------------------------------------------------------------------------

  const isLoading = status === 'loading';

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">

        {/* Brand header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Noshowly</h1>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Create your account</h2>

          <form onSubmit={handleSubmit} noValidate className="space-y-5">

            {/* Salon name */}
            <div>
              <label
                htmlFor="salonName"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Salon name
              </label>
              <input
                id="salonName"
                type="text"
                autoComplete="organization"
                required
                disabled={isLoading}
                value={form.salonName}
                onChange={(e) => handleChange('salonName', e.target.value)}
                placeholder="e.g. Salon Elena"
                maxLength={100}
                className="
                  w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900
                  placeholder:text-gray-400
                  focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent
                  disabled:bg-gray-50 disabled:text-gray-400
                  transition
                "
              />
            </div>

            {/* Email */}
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

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                disabled={isLoading}
                value={form.password}
                onChange={(e) => handleChange('password', e.target.value)}
                placeholder="At least 8 characters"
                className="
                  w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900
                  placeholder:text-gray-400
                  focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent
                  disabled:bg-gray-50 disabled:text-gray-400
                  transition
                "
              />
            </div>

            {/* Confirm password */}
            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                disabled={isLoading}
                value={form.confirmPassword}
                onChange={(e) => handleChange('confirmPassword', e.target.value)}
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

            {/* Error banner */}
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
              {isLoading ? 'Creating account…' : 'Start free trial'}
            </button>

          </form>

          {/* Legal note */}
          <p className="mt-4 text-xs text-gray-400 text-center">
            By creating an account you agree to our{' '}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-gray-600">
              Privacy Policy
            </Link>{' '}
            and{' '}
            <Link href="/terms" className="underline underline-offset-2 hover:text-gray-600">
              Terms of Service
            </Link>
            .
          </p>
        </div>

        {/* Sign-in link */}
        <p className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-black underline underline-offset-4 hover:text-gray-700"
          >
            Sign in
          </Link>
        </p>

      </div>
    </main>
  );
}
