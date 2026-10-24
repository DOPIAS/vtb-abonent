import { Lesson } from './types';

export function nextScheduledLesson(
  lessons: Lesson[],
  now = Date.now(),
): Lesson | undefined {
  return lessons
    .filter(
      (lesson) =>
        lesson.status === 'scheduled' &&
        new Date(lesson.scheduledAt).getTime() >= now,
    )
    .sort(
      (a, b) =>
        new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    )[0];
}
