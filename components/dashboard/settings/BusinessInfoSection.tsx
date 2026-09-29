/**
 * components/dashboard/settings/BusinessInfoSection.tsx
 *
 * Settings section 1, Business info: the business name, the timezone (the
 * common timezones, plus the salon's current one when it is not among them)
 * and the price currency. Auto-saves 800 ms after any field change
 * (useBusinessInfoSave in useSectionSaves.ts).
 */

'use client';

import { Input } from '@/components/ui/input';
import { FieldLabel, SaveIndicator } from '@/components/dashboard/settings/SettingsControls';
import { timezoneOptions } from '@/components/dashboard/settings/settings-helpers';
import { formatTimeZoneLabel } from '@/lib/time';
import type { BusinessInfoSave } from '@/components/dashboard/settings/useSectionSaves';
import type { BusinessInfoFields } from '@/components/dashboard/settings/useSettingsData';

/** Currencies offered in the price currency select. */
const CURRENCY_OPTIONS = [
  { code: 'USD', label: '$ USD: US Dollar' },
  { code: 'EUR', label: '€ EUR: Euro' },
  { code: 'GBP', label: '£ GBP: British Pound' },
  { code: 'AUD', label: 'A$ AUD: Australian Dollar' },
  { code: 'CAD', label: 'C$ CAD: Canadian Dollar' },
  { code: 'CHF', label: 'Fr CHF: Swiss Franc' },
  { code: 'JPY', label: '¥ JPY: Japanese Yen' },
  { code: 'CNY', label: '¥ CNY: Chinese Yuan' },
  { code: 'INR', label: '₹ INR: Indian Rupee' },
  { code: 'BRL', label: 'R$ BRL: Brazilian Real' },
  { code: 'MXN', label: '$ MXN: Mexican Peso' },
  { code: 'SGD', label: 'S$ SGD: Singapore Dollar' },
  { code: 'HKD', label: 'HK$ HKD: Hong Kong Dollar' },
  { code: 'NOK', label: 'kr NOK: Norwegian Krone' },
  { code: 'SEK', label: 'kr SEK: Swedish Krona' },
  { code: 'DKK', label: 'kr DKK: Danish Krone' },
  { code: 'NZD', label: 'NZ$ NZD: New Zealand Dollar' },
  { code: 'ZAR', label: 'R ZAR: South African Rand' },
  { code: 'AED', label: 'AED: UAE Dirham' },
  { code: 'SAR', label: 'SAR: Saudi Riyal' },
  { code: 'QAR', label: 'QAR: Qatari Riyal' },
  { code: 'KWD', label: 'KD KWD: Kuwaiti Dinar' },
  { code: 'TRY', label: '₺ TRY: Turkish Lira' },
  { code: 'PLN', label: 'zł PLN: Polish Zloty' },
  { code: 'CZK', label: 'Kč CZK: Czech Koruna' },
  { code: 'HUF', label: 'Ft HUF: Hungarian Forint' },
  { code: 'RON', label: 'lei RON: Romanian Leu' },
  { code: 'BGN', label: 'лв BGN: Bulgarian Lev' },
  { code: 'ILS', label: '₪ ILS: Israeli Shekel' },
  { code: 'KRW', label: '₩ KRW: South Korean Won' },
  { code: 'THB', label: '฿ THB: Thai Baht' },
  { code: 'MYR', label: 'RM MYR: Malaysian Ringgit' },
  { code: 'IDR', label: 'Rp IDR: Indonesian Rupiah' },
  { code: 'PHP', label: '₱ PHP: Philippine Peso' },
] as const;

type BusinessInfoSectionProps = {
  /** Name, timezone and currency, with their setters. */
  fields: BusinessInfoFields;
  /** The section's auto-save. */
  save: BusinessInfoSave;
};

/**
 * Renders the Business info section.
 *
 * @param props - The section's fields and auto-save.
 * @returns The section JSX.
 */
export default function BusinessInfoSection({ fields, save }: BusinessInfoSectionProps) {
  const { salonName, setSalonName, timezone, setTimezone, currency, setCurrency } = fields;
  const { salonInfoSaveStatus, salonInfoError, scheduleSalonInfoSave } = save;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-heading text-base font-semibold text-[#1A1A1A]">Business info</h2>
        <SaveIndicator status={salonInfoSaveStatus} />
      </div>

      <div className="bg-white rounded-2xl border border-[#E5E2DB] p-6 space-y-5">

        {/* Business name */}
        <div className="space-y-1.5">
          <FieldLabel htmlFor="salon-name">Business name</FieldLabel>
          <Input
            id="salon-name"
            type="text"
            value={salonName}
            onChange={(e) => {
              const v = e.target.value;
              setSalonName(v);
              scheduleSalonInfoSave(v, timezone, currency);
            }}
            placeholder="e.g. City Dental Clinic"
            maxLength={100}
            className="border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#6F6B65]"
          />
          <p className="text-xs text-[#6F6B65] font-body">This is the name your clients see in reminder messages.</p>
        </div>

        {/* Timezone */}
        <div className="space-y-1.5">
          <FieldLabel htmlFor="salon-timezone">Timezone</FieldLabel>
          <select
            id="salon-timezone"
            value={timezone}
            onChange={(e) => {
              const v = e.target.value;
              setTimezone(v);
              scheduleSalonInfoSave(salonName, v, currency);
            }}
            className="w-full h-10 rounded-lg border border-[#E5E2DB] px-3 text-sm text-[#1A1A1A] bg-white outline-none focus:border-[#1B4332] transition-colors"
          >
            {/* The salon's current timezone is always listed, even when it is not a common one. */}
            {timezoneOptions(timezone).map((tz) => (
              <option key={tz} value={tz}>{formatTimeZoneLabel(tz)}</option>
            ))}
          </select>
          <p className="text-xs text-[#6F6B65] font-body">All appointment times are shown in this timezone.</p>
        </div>

        {/* Currency */}
        <div className="space-y-1.5">
          <FieldLabel htmlFor="salon-currency">Price currency</FieldLabel>
          <select
            id="salon-currency"
            value={currency}
            onChange={(e) => {
              const v = e.target.value;
              setCurrency(v);
              scheduleSalonInfoSave(salonName, timezone, v);
            }}
            className="w-full h-10 rounded-lg border border-[#E5E2DB] px-3 text-sm text-[#1A1A1A] bg-white outline-none focus:border-[#1B4332] transition-colors"
          >
            {CURRENCY_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code}>{opt.label}</option>
            ))}
          </select>
          <p className="text-xs text-[#6F6B65] font-body">Used for displaying service prices on your booking page.</p>
        </div>

      </div>

      {salonInfoError && (
        <div role="alert" className="mt-3 rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
          {salonInfoError}
        </div>
      )}
    </section>
  );
}
