/**
 * app/register/page.tsx
 *
 * Premium registration page for Noshowly salon owners.
 *
 * Only business owners register — end clients never have accounts.
 *
 * Security:
 *  - Inputs validated client-side AND server-side (in the API route).
 *  - Raw Supabase error messages never surfaced to the user.
 *  - Form disabled while submitting to prevent duplicate submissions.
 */

'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Shape of the registration form's local state. */
interface RegisterFormState {
  salonName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

/** Possible UI states for the form. */
type FormStatus = 'idle' | 'loading' | 'error' | 'success';

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

  /**
   * Updates a single form field while clearing any displayed error.
   *
   * @param field - The field name to update.
   * @param value - The new value.
   */
  function handleChange(field: keyof RegisterFormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (status === 'error') {
      setStatus('idle');
      setErrorMessage('');
    }
  }

  /**
   * Validates all form fields before making any network calls.
   *
   * @param fields - The current form state to validate.
   * @returns A user-facing error string, or null if all inputs are valid.
   */
  function validate(fields: RegisterFormState): string | null {
    const { salonName, email, password, confirmPassword } = fields;

    if (!salonName.trim()) return 'Business name is required.';
    if (salonName.trim().length > 100) return 'Business name must be 100 characters or fewer.';
    if (!email.trim()) return 'Email is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return 'Please enter a valid email address.';
    }
    if (!password) return 'Password is required.';
    if (password.length < 8) return 'Password must be at least 8 characters.';
    if (password !== confirmPassword) return 'Passwords do not match.';

    return null;
  }

  /**
   * Handles form submission: validates, creates auth user, creates DB records.
   *
   * @param e - The form submit event.
   */
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const validationError = validate(form);
    if (validationError) {
      setStatus('error');
      setErrorMessage(validationError);
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: form.email.trim().toLowerCase(),
        password: form.password,
        options: {
          data: { salon_name: form.salonName.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (signUpError) {
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

      if (!signUpData.session) {
        setStatus('success');
        return;
      }

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonName: form.salonName.trim() }),
      });

      if (!res.ok) {
        await supabase.auth.signOut();
        setStatus('error');
        setErrorMessage(
          'Your account was created but setup could not be completed. ' +
            'Please try again or contact support.'
        );
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      setStatus('error');
      setErrorMessage('Something went wrong. Please check your connection and try again.');
    }
  }

  // Email confirmation screen
  if (status === 'success') {
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
          <div className="bg-white rounded-2xl border border-[#E5E2DB] p-8 shadow-sm text-center">
            <div className="w-12 h-12 bg-[#E8F2EC] rounded-full flex items-center justify-center mx-auto mb-5">
              <svg
                className="w-6 h-6 text-[#1B4332]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="font-heading text-2xl font-bold text-[#1A1A1A] mb-2">
              Check your email
            </h2>
            <p className="text-sm text-[#8A8680] font-body mb-1">We sent a confirmation link to:</p>
            <p className="text-sm font-semibold text-[#1A1A1A] font-body mb-4">{form.email}</p>
            <p className="text-sm text-[#8A8680] font-body">
              Click the link in the email to activate your account and get started.
            </p>
          </div>
          <p className="mt-6 text-center text-sm text-[#8A8680] font-body">
            Wrong email?{' '}
            <button
              type="button"
              onClick={() => setStatus('idle')}
              className="font-medium text-[#1B4332] underline underline-offset-4 hover:text-[#16392A]"
            >
              Go back
            </button>
          </p>
        </motion.div>
      </main>
    );
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

        {/* Card */}
        <div className="bg-white rounded-2xl border border-[#E5E2DB] p-8 shadow-sm">
          <h2 className="font-heading text-2xl font-bold text-[#1A1A1A] mb-1">
            Create your account
          </h2>
          <p className="text-sm text-[#8A8680] font-body mb-7">
            Set up your business in minutes.
          </p>

          <form onSubmit={handleSubmit} noValidate className="space-y-5">

            {/* Business name */}
            <div className="space-y-1.5">
              <Label htmlFor="salonName" className="text-sm font-medium text-[#1A1A1A] font-body">
                Business name
              </Label>
              <Input
                id="salonName"
                type="text"
                autoComplete="organization"
                required
                disabled={isLoading}
                value={form.salonName}
                onChange={(e) => handleChange('salonName', e.target.value)}
                placeholder="e.g. City Dental Clinic"
                maxLength={100}
                className="h-11 border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
              />
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium text-[#1A1A1A] font-body">
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
              <Label htmlFor="password" className="text-sm font-medium text-[#1A1A1A] font-body">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                disabled={isLoading}
                value={form.password}
                onChange={(e) => handleChange('password', e.target.value)}
                placeholder="At least 8 characters"
                className="h-11 border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A]"
              />
            </div>

            {/* Confirm password */}
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword" className="text-sm font-medium text-[#1A1A1A] font-body">
                Confirm password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                disabled={isLoading}
                value={form.confirmPassword}
                onChange={(e) => handleChange('confirmPassword', e.target.value)}
                placeholder="••••••••"
                className="h-11 border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A]"
              />
            </div>

            {/* Error */}
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
              className="w-full h-11 bg-[#1B4332] hover:bg-[#16392A] text-white text-sm font-semibold font-body rounded-lg transition-colors"
            >
              {isLoading ? 'Creating account…' : 'Create account'}
            </Button>

          </form>

          {/* Legal */}
          <p className="mt-5 text-xs text-[#8A8680] font-body text-center">
            By creating an account you agree to our{' '}
            <Link href="/privacy" className="underline underline-offset-2 text-[#1B4332] hover:text-[#16392A]">
              Privacy Policy
            </Link>{' '}
            and{' '}
            <Link href="/terms" className="underline underline-offset-2 text-[#1B4332] hover:text-[#16392A]">
              Terms of Service
            </Link>
            .
          </p>
        </div>

        {/* Sign-in link */}
        <p className="mt-7 text-center text-sm text-[#8A8680] font-body">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-[#1B4332] underline underline-offset-4 hover:text-[#16392A]"
          >
            Sign in
          </Link>
        </p>
      </motion.div>
    </main>
  );
}
