import {
  localInput,
  parseLocalDate,
  rublesToKopecks,
} from '../src/core/format';
it('preserves local input while rejecting invalid calendar days and times', () => {
  expect(parseLocalDate('2026-02-30 12:00')).toBeNull();
  expect(parseLocalDate('2026-10-24 25:00')).toBeNull();
  const date = parseLocalDate('2026-10-24 14:30');
  expect(date).not.toBeNull();
  expect(localInput(date!)).toBe('2026-10-24 14:30');
});
it('converts decimal rubles to integer kopecks', () => {
  expect(rublesToKopecks('100,01')).toBe(10001);
  expect(rublesToKopecks('0.29')).toBe(29);
});
