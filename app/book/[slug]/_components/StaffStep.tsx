/**
 * app/book/[slug]/_components/StaffStep.tsx
 *
 * Staff step of the public booking page: "Any available staff" when more
 * than one person can be booked, then one row per bookable staff member with
 * their photo (or initials) and bio. When nobody can be booked online, a
 * message asks visitors to contact the business instead.
 */

'use client';

import { getInitials } from '@/lib/utils';
import type { PublicBarber } from '@/types';

type StaffStepProps = {
  /** Staff members who can be booked, ordered by name. */
  bookableBarbers: PublicBarber[];
  /** Whether "Any available staff" is offered (more than one person to choose from). */
  offerAnyStaff: boolean;
  /** Called with the chosen staff member, or 'any'. */
  onSelect: (choice: PublicBarber | 'any') => void;
};

/**
 * Lists the staff members the visitor can book with.
 *
 * @param props - Bookable staff, whether "any" is offered, and the selection callback.
 */
export default function StaffStep({ bookableBarbers, offerAnyStaff, onSelect }: StaffStepProps) {
  return (
    <div className="bg-white rounded-2xl border border-[#E5E2DB] overflow-hidden shadow-sm">
      <div className="px-6 pt-6 pb-5 border-b border-[#E5E2DB]/40">
        <h2 className="font-heading text-2xl font-bold text-[#1A1A1A]">
          Select a staff member
        </h2>
        <p className="font-body text-sm text-[#8A8680] mt-1">Choose who you&apos;d like to see</p>
      </div>

      {bookableBarbers.length === 0 ? (
        <div className="p-6 text-center">
          <p className="font-body text-sm text-[#8A8680]">
            Online booking is not available right now. Please contact us directly.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#E5E2DB]/60">
          {offerAnyStaff && (
            <button
              type="button"
              onClick={() => onSelect('any')}
              className="w-full flex items-center gap-4 px-6 py-5 hover:bg-[#F5FAF7] transition-colors text-left group"
            >
              <div className="w-14 h-14 rounded-full bg-[#F5F3EF] border-2 border-transparent group-hover:border-[#1B4332]/30 flex items-center justify-center text-lg text-[#1B4332] shrink-0 transition-colors">
                &#10033;
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-body text-sm font-semibold text-[#1A1A1A]">Any available staff</p>
                <p className="font-body text-xs text-[#8A8680] mt-0.5">See every free time and we&apos;ll assign someone</p>
              </div>
              <span className="text-[#8A8680] group-hover:text-[#1B4332] transition-colors shrink-0">&#8594;</span>
            </button>
          )}
          {bookableBarbers.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onSelect(b)}
              className="w-full flex items-center gap-4 px-6 py-5 hover:bg-[#F5FAF7] transition-colors text-left group"
            >
              {b.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- photos saved before uploads were required can be on any host, which next/image would have to allow-list
                <img
                  src={b.photo_url}
                  alt={b.name}
                  className="w-14 h-14 rounded-full object-cover shrink-0 border-2 border-[#E5E2DB] group-hover:border-[#1B4332]/40 transition-colors"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-[#E8F2EC] border-2 border-transparent group-hover:border-[#1B4332]/30 flex items-center justify-center text-sm font-semibold text-[#1B4332] shrink-0 transition-colors">
                  {getInitials(b.name)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-body text-sm font-semibold text-[#1A1A1A]">{b.name}</p>
                {b.bio && (
                  <p className="font-body text-xs text-[#8A8680] mt-0.5 line-clamp-2">{b.bio}</p>
                )}
              </div>
              <span className="text-[#8A8680] group-hover:text-[#1B4332] transition-colors shrink-0">&#8594;</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
