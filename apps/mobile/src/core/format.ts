export const money = (kopecks: number) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: kopecks % 100 === 0 ? 0 : 2,
  }).format(kopecks / 100);
export const dateTime = (value: string) =>
  new Date(value).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
export function localInput(value = new Date(Date.now() + 3600000)): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${two(value.getMonth() + 1)}-${two(value.getDate())} ${two(value.getHours())}:${two(value.getMinutes())}`;
}
export function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  return localInput(date) === value.trim() && Number(year) >= 2000
    ? date
    : null;
}
export function rublesToKopecks(value: string): number {
  return Math.round(Number(value.replace(',', '.')) * 100);
}
