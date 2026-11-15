// Tiny shared helpers for money and phone numbers. FROZEN contract.
import type { Cents } from './types';

/** 3499 -> "$34.99", 100000 -> "$1,000.00" */
export function formatCents(cents: Cents): string {
  const whole = Math.floor(Math.abs(cents) / 100);
  const frac = String(Math.abs(cents) % 100).padStart(2, '0');
  const withCommas = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}$${withCommas}.${frac}`;
}

/** Last 4 digits only. Use this in every log line and stored document. */
export function last4(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.slice(-4);
}

/** "(214) 555-0100" / "2145550100" / "+12145550100" -> "+12145550100". Returns null if it is not a phone. */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (raw.trim().startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}
