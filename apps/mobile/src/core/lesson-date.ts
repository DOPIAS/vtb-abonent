export type LessonDateTime = { date: string; time: string };

const two = (value: number) => String(value).padStart(2, '0');

export function lessonDateTime(value: Date): LessonDateTime {
  return {
    date: `${value.getFullYear()}-${two(value.getMonth() + 1)}-${two(value.getDate())}`,
    time: `${two(value.getHours())}:${two(value.getMinutes())}`,
  };
}

export function initialLessonDateTime(initial?: string): LessonDateTime {
  const existing = initial ? new Date(initial) : null;
  if (existing && !Number.isNaN(existing.getTime()))
    return lessonDateTime(existing);
  const next = new Date(Date.now() + 60 * 60 * 1000);
  next.setMinutes(Math.ceil(next.getMinutes() / 15) * 15, 0, 0);
  return lessonDateTime(next);
}

// Construct in the device timezone, then check every part. This rejects both
// impossible calendar dates and local times skipped by a daylight-saving change.
export function parseLessonDateTime(value: LessonDateTime): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(value.time);
  if (!dateMatch || !timeMatch) return null;
  const year = Number(dateMatch[1]);
  if (year < 2000 || year > 2100) return null;
  const date = new Date(
    year,
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  );
  const checked = lessonDateTime(date);
  return checked.date === value.date && checked.time === value.time
    ? date
    : null;
}

export function lessonDateLabel(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year!, month! - 1, day!, 12).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function lessonTimezoneLabel(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone
    ? `Часовой пояс устройства: ${zone}`
    : 'Часовой пояс вашего устройства';
}
