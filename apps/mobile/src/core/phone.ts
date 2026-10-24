export const PHONE_ERROR = 'Введите российский номер: +7 (999) 123-45-67';

// Structural validation for Russian mobile and landline numbers. Empty means
// the optional phone is unset; null means invalid. Formatting never discards
// letters or unexpected punctuation, including misplaced plus signs.
export function normalizeRussianPhone(value: string): string | null {
  const input = value.replace(/^ +| +$/g, '');
  if (input === '') return '';
  if (!/^\+?[0-9 ()-]+$/.test(input) || /[\r\n]/.test(input)) return null;
  const compact = input.replace(/[ ()-]/g, '');
  if (/^\+7[3489][0-9]{9}$/.test(compact)) return compact;
  if (/^[78][3489][0-9]{9}$/.test(compact)) return `+7${compact.slice(1)}`;
  if (/^[3489][0-9]{9}$/.test(compact)) return `+7${compact}`;
  return null;
}
