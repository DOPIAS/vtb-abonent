import { nextScheduledLesson } from '../src/core/next-lesson';
import { Lesson } from '../src/core/types';

const now = new Date('2026-10-24T04:00:00Z').getTime();
const lesson = (
  id: string,
  scheduledAt: string,
  status: Lesson['status'] = 'scheduled',
): Lesson => ({
  id,
  scheduledAt,
  status,
  packageId: 'p1',
  updatedAt: scheduledAt,
});

it('selects the nearest future scheduled lesson, ignoring past and changed statuses', () => {
  const lessons = [
    lesson('later', '2026-10-26T04:00:00Z'),
    lesson('cancelled', '2026-10-24T05:00:00Z', 'cancelled'),
    lesson('completed', '2026-10-24T04:30:00Z', 'completed'),
    lesson('past', '2026-10-23T04:00:00Z'),
    lesson('nearest', '2026-10-25T04:00:00Z'),
  ];
  expect(nextScheduledLesson(lessons, now)?.id).toBe('nearest');
  expect(lessons[0]?.id).toBe('later');
});

it('includes a lesson starting now and has an empty state when none remain', () => {
  expect(
    nextScheduledLesson([lesson('now', '2026-10-24T04:00:00Z')], now)?.id,
  ).toBe('now');
  expect(
    nextScheduledLesson([lesson('past', '2026-10-23T04:00:00Z')], now),
  ).toBeUndefined();
  expect(nextScheduledLesson([], now)).toBeUndefined();
});
