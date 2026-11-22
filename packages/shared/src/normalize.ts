/** Normalize an Indian mobile number to 10 digits. Returns null if invalid. */
export function normalizeIndianPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = input.replace(/[^\d]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export function normalizeSku(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '-');
}

export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,39}$/;
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

/** Password policy (specification.md §4). Returns an error message or null. */
export function passwordPolicyError(password: string, username?: string): string | null {
  if (password.length < 10) return 'Password must be at least 10 characters';
  if (password.length > 128) return 'Password must be at most 128 characters';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Password must contain at least one letter and one digit';
  }
  if (username && password.toLowerCase() === username.toLowerCase()) {
    return 'Password must not be the same as the username';
  }
  return null;
}
