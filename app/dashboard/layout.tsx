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
 */

import Image from 'next/image';
import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getEntitlements, type Entitlements } from '@/lib/entitlements';
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

/**
 * Loads the salon name and the plan of the signed-in owner.
 * Errors are non-fatal: the layout renders with fallbacks.
 */
async function loadDashboardAccount(): Promise<DashboardAccount> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    // Middleware redirects signed-out visitors before this renders.
    if (!session) return FALLBACK_ACCOUNT;

    const [salonResult, userResult] = await Promise.all([
      supabase.from('salons').select('name').eq('user_id', session.user.id).limit(1),
      supabase.from('users').select('plan, trial_ends_at').eq('id', session.user.id).maybeSingle(),
    ]);

    const salonName = salonResult.data?.[0]?.name || FALLBACK_ACCOUNT.salonName;
    if (userResult.error || !userResult.data) return { ...FALLBACK_ACCOUNT, salonName };

    const entitlements = getEntitlements(userResult.data, new Date());
    return { salonName, banner: bannerFor(entitlements), isPaid: entitlements.isPaid };
  } catch {
    // Non-fatal — layout renders with fallback values
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
          <p className="text-xs font-medium text-white/40 uppercase tracking-widest mb-0.5">
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
                text-white/40 hover:text-white/70 hover:bg-white/5
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
