import { IsEmail, IsIn, IsString, MaxLength } from 'class-validator';

export const BUSINESS_TYPES = ['retail', 'wholesale', 'warehouse', 'mixed'] as const;
export const CURRENCIES = ['GHS', 'USD', 'NGN', 'GBP', 'EUR'] as const;
export const TIME_ZONES = ['Africa/Accra', 'Africa/Lagos', 'Europe/London', 'America/New_York', 'UTC'] as const;
export const DATE_FORMATS = ['day_month_year', 'month_day_year', 'year_month_day'] as const;

export type BusinessType = typeof BUSINESS_TYPES[number];
export type Currency = typeof CURRENCIES[number];
export type TimeZone = typeof TIME_ZONES[number];
export type DateFormat = typeof DATE_FORMATS[number];

export class UpdateCompanySettingsDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsIn(BUSINESS_TYPES)
  businessType!: BusinessType;

  @IsEmail({}, { message: 'Contact email must be a valid email address' })
  @MaxLength(255)
  contactEmail!: string;

  @IsString()
  @MaxLength(40)
  phone!: string;

  @IsString()
  @MaxLength(300)
  address!: string;

  @IsIn(CURRENCIES)
  currency!: Currency;

  @IsIn(TIME_ZONES)
  timeZone!: TimeZone;

  @IsIn(DATE_FORMATS)
  dateFormat!: DateFormat;
}
