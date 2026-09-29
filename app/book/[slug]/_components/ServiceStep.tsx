/**
 * app/book/[slug]/_components/ServiceStep.tsx
 *
 * Service step of the public booking page: a card per service the visitor can
 * book with their staff choice, with its duration and price. A chosen staff
 * member's overrides apply; with "Any available staff" the card shows the
 * range over everyone who can perform the service. "Change staff member"
 * leads back when there was a staff choice to make.
 */

'use client';

import type { PublicService } from '@/types';
import { serviceDurationLabel, servicePriceLabel, type StaffScope } from './selection';

type ServiceStepProps = {
  /** Services the visitor can pick with their staff choice. */
  availableServices: PublicService[];
  /** Staff data and the staff choice, for the duration and price labels. */
  staffScope: StaffScope;
  /** Symbol of the salon's currency, e.g. "€". */
  currencySymbol: string;
  /** True when the staff step has a real choice to make. */
  hasStaffChoice: boolean;
  /** Called with the chosen service. */
  onSelect: (service: PublicService) => void;
  /** Goes back to the staff step. */
  onChangeStaff: () => void;
};

/**
 * Lists the services the visitor can book.
 *
 * @param props - Services, what their labels depend on, and the callbacks.
 */
export default function ServiceStep({
  availableServices,
  staffScope,
  currencySymbol,
  hasStaffChoice,
  onSelect,
  onChangeStaff,
}: ServiceStepProps) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-[#E5E2DB] overflow-hidden shadow-sm">
        <div className="px-6 pt-6 pb-5 border-b border-[#E5E2DB]/40">
          <h2 className="font-heading text-2xl font-bold text-[#1A1A1A]">Choose a service</h2>
          <p className="font-body text-sm text-[#8A8680] mt-1">Select what you&apos;d like to book</p>
        </div>

        {availableServices.length === 0 ? (
          <div className="p-6 text-center">
            <p className="font-body text-sm text-[#8A8680]">No services are available for this selection.</p>
          </div>
        ) : (
          <div className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {availableServices.map((svc) => {
                // Effective price/duration: the staff member's overrides when one is selected.
                const durationLabel = serviceDurationLabel(staffScope, svc);
                const priceLabel = servicePriceLabel(staffScope, svc, currencySymbol);
                return (
                  <button
                    key={svc.id}
                    type="button"
                    onClick={() => onSelect(svc)}
                    className="text-left p-5 rounded-xl border border-[#E5E2DB] hover:border-[#1B4332]/50 hover:bg-[#E8F2EC]/20 hover:shadow-sm transition-all group"
                  >
                    <p className="font-body text-sm font-semibold text-[#1A1A1A] leading-snug mb-3">
                      {svc.name}
                    </p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {durationLabel && (
                          <span className="font-body text-[11px] bg-[#F5F3EF] text-[#4A4540] px-2.5 py-1 rounded-full font-medium">
                            {durationLabel} min
                          </span>
                        )}
                      </div>
                      {priceLabel && (
                        <span className="font-body text-sm font-semibold text-[#1B4332]">
                          {priceLabel}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {hasStaffChoice && (
        <button
          type="button"
          onClick={onChangeStaff}
          className="font-body text-sm text-[#8A8680] hover:text-[#1B4332] transition-colors"
        >
          &#8592; Change staff member
        </button>
      )}
    </div>
  );
}
