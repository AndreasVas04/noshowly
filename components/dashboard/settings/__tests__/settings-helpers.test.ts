/**
 * components/dashboard/settings/__tests__/settings-helpers.test.ts
 *
 * Unit tests for the Settings page helpers in
 * components/dashboard/settings/settings-helpers.ts: the timezone options,
 * the business name and business hours checks, and the sample values of the
 * reminder email preview.
 */

import { describe, expect, it } from 'vitest';
import {
  businessHoursError,
  previewVariables,
  salonNameError,
  timezoneOptions,
} from '@/components/dashboard/settings/settings-helpers';
import {
  DEFAULT_EMAIL_FOOTER,
  DEFAULT_EMAIL_GREETING,
  applyTemplate,
} from '@/lib/reminder-templates';

describe('timezoneOptions', () => {
  it('lists the common timezones, UTC first, when the salon uses one of them', () => {
    const options = timezoneOptions('Europe/Nicosia');
    expect(options[0]).toBe('UTC');
    expect(options.filter((tz) => tz === 'Europe/Nicosia')).toHaveLength(1);
    expect(timezoneOptions('America/New_York')).toEqual(options);
  });

  it('lists the salon timezone first when it is not a common one', () => {
    const options = timezoneOptions('Asia/Kolkata');
    expect(options[0]).toBe('Asia/Kolkata');
    expect(options.slice(1)).toEqual(timezoneOptions('UTC'));
  });

  it('never lists a timezone twice', () => {
    for (const timezone of ['UTC', 'Europe/London', 'Asia/Kolkata']) {
      const options = timezoneOptions(timezone);
      expect(new Set(options).size).toBe(options.length);
    }
  });
});

describe('salonNameError', () => {
  it('requires a name', () => {
    expect(salonNameError('')).toBe('Business name is required.');
  });

  it('accepts up to 100 characters', () => {
    expect(salonNameError('Salon Elena')).toBeNull();
    expect(salonNameError('x'.repeat(100))).toBeNull();
    expect(salonNameError('x'.repeat(101))).toBe('Business name must be 100 characters or fewer.');
  });
});

describe('businessHoursError', () => {
  it('accepts a closing time after the opening time', () => {
    expect(businessHoursError('09:00', '20:00')).toBeNull();
    expect(businessHoursError('09:00', '09:01')).toBeNull();
  });

  it('rejects a closing time at or before the opening time', () => {
    expect(businessHoursError('20:00', '09:00')).toBe('Closing time must be after opening time.');
    expect(businessHoursError('09:00', '09:00')).toBe('Closing time must be after opening time.');
  });

  it('does not check the range while a time is empty', () => {
    expect(businessHoursError('', '09:00')).toBeNull();
    expect(businessHoursError('20:00', '')).toBeNull();
    expect(businessHoursError('', '')).toBeNull();
  });
});

describe('previewVariables', () => {
  it('fills a sample appointment with the trimmed business name', () => {
    expect(previewVariables('  Salon Elena ')).toEqual({
      client_name:   'John',
      business_name: 'Salon Elena',
      service:       'Haircut',
      time:          '10:30',
      date:          'Tuesday 16 June',
    });
  });

  it('falls back to "Your Business" for a blank name', () => {
    expect(previewVariables('').business_name).toBe('Your Business');
    expect(previewVariables('   ').business_name).toBe('Your Business');
  });

  it('fills the default templates', () => {
    const vars = previewVariables('Salon Elena');
    expect(applyTemplate(DEFAULT_EMAIL_GREETING, vars)).toBe('Hi John,');
    expect(applyTemplate(DEFAULT_EMAIL_FOOTER, { business_name: vars.business_name }))
      .toBe('If you have questions, contact Salon Elena directly.');
  });
});
