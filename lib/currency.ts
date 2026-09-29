/**
 * lib/currency.ts
 *
 * Display symbols of the currencies a salon can price its services in
 * (salons.currency, an ISO 4217 code). Used by the public booking page and
 * the service editor in the dashboard, so prices look the same in both.
 *
 * No imports from Next.js or Supabase, so this is safe to use anywhere.
 */

/** ISO 4217 code → display symbol. */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  USD: '$',  EUR: '€',  GBP: '£',  AUD: 'A$', CAD: 'C$',
  CHF: 'Fr', JPY: '¥',  CNY: '¥',  INR: '₹',  BRL: 'R$',
  MXN: '$',  SGD: 'S$', HKD: 'HK$',NOK: 'kr', SEK: 'kr',
  DKK: 'kr', NZD: 'NZ$',ZAR: 'R',  AED: 'د.إ',SAR: '﷼',
  QAR: '﷼',  KWD: 'KD', TRY: '₺',  PLN: 'zł', CZK: 'Kč',
  HUF: 'Ft', RON: 'lei',BGN: 'лв', ILS: '₪',  KRW: '₩',
  THB: '฿',  MYR: 'RM', IDR: 'Rp', PHP: '₱',
};

/**
 * Returns the display symbol of a currency.
 *
 * @param code - ISO 4217 currency code, e.g. 'EUR'.
 * @returns    The symbol, e.g. '€', or the code itself when it has none.
 */
export function getCurrencySymbol(code: string): string {
  return Object.hasOwn(CURRENCY_SYMBOLS, code) ? CURRENCY_SYMBOLS[code] : code;
}
