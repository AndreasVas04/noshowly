/**
 * app/dashboard/layout.tsx
 *
 * Shared layout for all /dashboard/* pages.
 *
 * Renders a two-column shell:
 *  - Left: fixed dark sidebar with navigation links (lg+ screens).
 *  - Right: scrollable main content area where each page renders, topped by
 *    the plan banner (components/dashboard/PlanBanner.tsx): days left in the
 *    free trial, or a read-only notice when the trial has ended or the
 *    subscription is inactive, with an "Upgrade" link. Nothing on paid plans.
 *
 * On mobile (<lg breakpoint) the sidebar collapses to a top navigation bar.
 *
 * Design: dark gradient sidebar, Playfair Display logo, Montserrat nav.
 * Active route highlighting handled client-side by DashboardNavLinks.
 *
 * This is a Server Component — fetches the salon name and the plan
 * server-side (lib/entitlements.ts).
 *
 * Self-repair: a signed-in owner without a users or salons row (a sign-up
 * that stopped halfway) gets the missing rows here, through the same
 * idempotent ensureAccount() the sign-up routes use (lib/account.ts), with
 * the salon name recorded at sign-up or "My Salon". If that fails, the banner
 * says so instead of every page failing with "Salon not found".
 */

import Image from 'next/image';
import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { accountSetupFromMetadata, ensureAccount } from '@/lib/account';
import { getEntitlements, type Entitlements } from '@/lib/entitlements';
import type { Database } from '@/types';
import LogoutButton from '@/components/layout/LogoutButton';
import DashboardNavLinks, { MobileBottomNav } from '@/components/dashboard/DashboardNavLinks';
import PlanBanner, { type PlanBannerState } from '@/components/dashboard/PlanBanner';

/** What the layout shows about the signed-in account. */
type DashboardAccount = {
  salonName: string;
  banner: PlanBannerState;
  /** Paid plans do not see the "Upgrade plan" link. */
  isPaid: boolean;
};

/** Shown when the account cannot be read. */
const FALLBACK_ACCOUNT: DashboardAccount = {
  salonName: 'My Business',
  banner: { kind: 'none' },
  isPaid: false,
};

/**
 * The banner for the account's entitlements.
 *
 * @param entitlements - From getEntitlements().
 */
function bannerFor(entitlements: Entitlements): PlanBannerState {
  if (entitlements.isPaid) return { kind: 'none' };
  if (entitlements.isTrial && !entitlements.trialExpired) {
    return { kind: 'trial', daysLeft: entitlements.trialDaysLeft ?? 0 };
  }
  return entitlements.isTrial ? { kind: 'trial_ended' } : { kind: 'inactive' };
}

/** The owner's rows as read by the layout. */
type AccountRows =
  | {
      ok: true;
      /** Salon name, or null when the owner has no salon. */
      salonName: string | null;
      /** users.plan and trial_ends_at, or null when the owner has no users row. */
      account: { plan: string; trial_ends_at: string } | null;
    }
  | { ok: false };

/**
 * Reads the owner's salon name and plan through RLS.
 *
 * While a request renders, Next.js answers a GET fetch identical to an
 * earlier one with the earlier response (request memoization), so reading
 * again after the repair below would return the rows as they were before it.
 * A request with an abort signal is never memoized, which is what `fresh`
 * does.
 *
 * @param supabase      - The signed-in user's client.
 * @param userId        - The verified user's id.
 * @param options.fresh - Read the database again, not a memoized response.
 */
async function readAccountRows(
  supabase: SupabaseClient<Database>,
  userId: string,
  options: { fresh?: boolean } = {},
): Promise<AccountRows> {
  let salonQuery = supabase.from('salons').select('name').eq('user_id', userId).limit(1);
  let userQuery = supabase.from('users').select('plan, trial_ends_at').eq('id', userId);
  if (options.fresh) {
    const { signal } = new AbortController();
    salonQuery = salonQuery.abortSignal(signal);
    userQuery = userQuery.abortSignal(signal);
  }

  const [salonResult, userResult] = await Promise.all([salonQuery, userQuery.maybeSingle()]);
  if (salonResult.error || userResult.error) return { ok: false };
  return {
    ok: true,
    salonName: salonResult.data?.[0]?.name ?? null,
    account: userResult.data ?? null,
  };
}

/**
 * Loads the salon name and the plan of the signed-in owner, first creating
 * the users or salons row when either is missing. Errors are non-fatal: the
 * layout renders with fallbacks.
 */
async function loadDashboardAccount(): Promise<DashboardAccount> {
  try {
    // Step 1: The verified user. getUser() (not getSession()) because the
    // repair below uses the user id with the service-role key.
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // The proxy (proxy.ts) redirects signed-out visitors before this renders.
    if (!user) return FALLBACK_ACCOUNT;

    let rows = await readAccountRows(supabase, user.id);

    // Step 2: A sign-up that stopped halfway — create the missing rows.
    if (rows.ok && (!rows.salonName || !rows.account)) {
      const result = await ensureAccount(createAdminSupabaseClient(), user, accountSetupFromMetadata(user));
      if (!result.ok) {
        console.error(`[dashboard] Could not complete the account of user=${user.id} (${result.step}): ${result.message}`);
        return { ...FALLBACK_ACCOUNT, banner: { kind: 'setup_failed' } };
      }
      console.log(
        `[dashboard] Completed the account of user=${user.id} ` +
        `(users row created: ${result.createdUser}, salon created: ${result.createdSalon})`
      );
      rows = await readAccountRows(supabase, user.id, { fresh: true });
    }

    // Step 3: Salon name and plan banner.
    if (!rows.ok) return FALLBACK_ACCOUNT;
    const salonName = rows.salonName || FALLBACK_ACCOUNT.salonName;
    if (!rows.account) return { ...FALLBACK_ACCOUNT, salonName };

    const entitlements = getEntitlements(rows.account, new Date());
    return { salonName, banner: bannerFor(entitlements), isPaid: entitlements.isPaid };
  } catch (err) {
    // Next.js signals (dynamic rendering, redirects) must reach Next.js.
    unstable_rethrow(err);
    // Non-fatal — layout renders with fallback values
    console.error('[dashboard] Failed to load the account:', err instanceof Error ? err.message : err);
    return FALLBACK_ACCOUNT;
  }
}

/**
 * DashboardLayout wraps every /dashboard/* page with the sidebar and header.
 * Fetches the salon name and plan server-side for zero client-side flash.
 *
 * @param children - The page content rendered in the main content area.
 * @returns The full dashboard shell with navigation.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { salonName, banner, isPaid } = await loadDashboardAccount();

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex flex-col lg:flex-row">

      {/* =================================================================
          SIDEBAR — hidden on mobile, visible as left column on lg+
      ================================================================== */}
      <aside
        className="hidden lg:flex lg:flex-col w-60 shrink-0 h-screen overflow-hidden sticky top-0"
        style={{ background: 'linear-gradient(180deg, #1B4332 0%, #122B20 100%)' }}
      >
        {/* Brand logo */}
        <div className="px-6 py-6 border-b border-white/10">
          <Image src="/Logo.png" alt="Noshowly" width={160} height={40} className="h-10 w-auto" />
        </div>

        {/* Business name */}
        <div className="px-6 py-4 border-b border-white/10">
          <p className="text-xs font-medium text-white/60 uppercase tracking-widest mb-0.5">
            Business
          </p>
          <p className="text-sm font-medium text-white/80 truncate">{salonName}</p>
        </div>

        {/* Nav links — client component for active-state detection */}
        <DashboardNavLinks />

        {/* Upgrade link — paid plans manage billing in Settings instead */}
        {!isPaid && (
          <div className="px-3 pb-2">
            <Link
              href="/pricing"
              className="
                flex items-center px-3 py-2.5 rounded-lg text-sm font-medium
                text-white/60 hover:text-white hover:bg-white/5
                transition-colors
              "
            >
              Upgrade plan
            </Link>
          </div>
        )}

        {/* Logout button */}
        <div className="px-3 py-4 border-t border-white/10">
          <LogoutButton />
        </div>
      </aside>

      {/* =================================================================
          MOBILE BOTTOM TAB BAR — fixed at bottom, visible below lg breakpoint
      ================================================================== */}
      <MobileBottomNav />

      {/* =================================================================
          MAIN CONTENT AREA
          pb-16 on mobile reserves space above the fixed bottom tab bar.
          The plan banner sits on top of every page, on mobile and desktop.
      ================================================================== */}
      <main className="flex-1 min-w-0 overflow-auto pb-16 lg:pb-0">
        <PlanBanner state={banner} />
        {children}
      </main>

    </div>
  );
}
