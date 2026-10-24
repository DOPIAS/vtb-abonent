import { useId, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  lessonDateLabel,
  lessonDateTime,
  lessonTimezoneLabel,
} from '../core/lesson-date';
import { useAppTheme } from '../core/theme';
import type { DateTimeFieldProps } from './DateTimeField.native';

const months = Array.from({ length: 12 }, (_, index) =>
  new Date(2026, index, 1).toLocaleDateString('ru-RU', { month: 'long' }),
);
const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const two = (value: number) => String(value).padStart(2, '0');
const controlFont =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export function DateTimeField({
  value,
  onChange,
  disabled,
}: DateTimeFieldProps) {
  const { colors, mode } = useAppTheme();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [year, month] = value.date.split('-').map(Number);
  const [visible, setVisible] = useState({ year: year!, month: month! - 1 });
  const [hour, minute] = value.time.split(':');
  const monthStart = new Date(visible.year, visible.month, 1, 12);
  const offset = (monthStart.getDay() + 6) % 7;
  const days = new Date(visible.year, visible.month + 1, 0, 12).getDate();
  const today = lessonDateTime(new Date()).date;
  const selectStyle = {
    backgroundColor: colors.surface,
    border: `1px solid ${colors.inputBorder}`,
    borderRadius: 10,
    color: colors.ink,
    colorScheme: mode,
    fontFamily: controlFont,
    fontSize: 16,
    minHeight: 48,
    padding: '10px 12px',
  } as const;
  const selectDate = (date: string) => {
    onChange({ ...value, date });
    setOpen(false);
  };
  const moveMonth = (step: number) => {
    const next = new Date(visible.year, visible.month + step, 1, 12);
    if (next.getFullYear() >= 2000 && next.getFullYear() <= 2100) {
      setVisible({ year: next.getFullYear(), month: next.getMonth() });
    }
  };
  const controlStyle = {
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
  };
  return (
    <View style={s.field}>
      <Text style={[s.label, { color: colors.ink }]}>Дата занятия</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Выбрать дату: ${lessonDateLabel(value.date)}`}
        accessibilityState={{ expanded: open, disabled }}
        aria-expanded={open}
        disabled={disabled}
        onPress={() => {
          if (!open) setVisible({ year: year!, month: month! - 1 });
          setOpen(!open);
        }}
        style={[s.dateButton, controlStyle, disabled && s.disabled]}
      >
        <Text style={[s.dateText, { color: colors.ink }]}>
          {lessonDateLabel(value.date)}
        </Text>
        <Text style={{ color: colors.blue }}>
          {open ? 'Закрыть ↑' : 'Календарь ↓'}
        </Text>
      </Pressable>
      {open && (
        <View
          style={[
            s.calendar,
            { backgroundColor: colors.surface, borderColor: colors.line },
          ]}
        >
          <View style={s.navigation}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Предыдущий месяц"
              disabled={
                disabled || (visible.year === 2000 && visible.month === 0)
              }
              onPress={() => moveMonth(-1)}
              style={[s.arrow, controlStyle]}
            >
              <Text style={[s.arrowText, { color: colors.blue }]}>‹</Text>
            </Pressable>
            <Text
              accessibilityLiveRegion="polite"
              style={[s.monthCaption, { color: colors.muted, flex: 1 }]}
            >
              {months[visible.month]} {visible.year}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Следующий месяц"
              disabled={
                disabled || (visible.year === 2100 && visible.month === 11)
              }
              onPress={() => moveMonth(1)}
              style={[s.arrow, controlStyle]}
            >
              <Text style={[s.arrowText, { color: colors.blue }]}>›</Text>
            </Pressable>
          </View>
          <View style={s.monthSelectors}>
            <select
              aria-label="Месяц"
              disabled={disabled}
              value={visible.month}
              onChange={(event) =>
                setVisible({ ...visible, month: Number(event.target.value) })
              }
              style={{
                ...selectStyle,
                flex: 1,
                minWidth: 0,
                textTransform: 'capitalize',
              }}
            >
              {months.map((name, index) => (
                <option key={name} value={index}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label="Год"
              disabled={disabled}
              value={visible.year}
              onChange={(event) =>
                setVisible({ ...visible, year: Number(event.target.value) })
              }
              style={{ ...selectStyle, width: 92 }}
            >
              {Array.from({ length: 101 }, (_, index) => index + 2000).map(
                (item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ),
              )}
            </select>
          </View>
          <View style={s.week}>
            {weekdays.map((day) => (
              <Text key={day} style={[s.weekday, { color: colors.muted }]}>
                {day}
              </Text>
            ))}
          </View>
          <View style={s.grid}>
            {Array.from(
              { length: Math.ceil((offset + days) / 7) * 7 },
              (_, index) => {
                const day = index - offset + 1;
                if (day < 1 || day > days)
                  return <View key={index} style={s.cell} />;
                const date = `${visible.year}-${two(visible.month + 1)}-${two(day)}`;
                const selected = value.date === date;
                return (
                  <View key={index} style={s.cell}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${lessonDateLabel(date)}${date === today ? ', сегодня' : ''}`}
                      accessibilityState={{ selected, disabled }}
                      aria-pressed={selected}
                      disabled={disabled}
                      onPress={() => selectDate(date)}
                      style={({ pressed }) => [
                        s.day,
                        {
                          backgroundColor: selected
                            ? colors.blue
                            : pressed
                              ? colors.pale
                              : 'transparent',
                          borderColor:
                            date === today ? colors.blue : 'transparent',
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: selected ? colors.onPrimary : colors.ink,
                          fontWeight: selected ? '700' : '400',
                          fontSize: 15,
                        }}
                      >
                        {day}
                      </Text>
                    </Pressable>
                  </View>
                );
              },
            )}
          </View>
          <View style={s.quickRow}>
            {['Сегодня', 'Завтра'].map((label, index) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                disabled={disabled}
                onPress={() => {
                  const day = new Date();
                  day.setDate(day.getDate() + index);
                  selectDate(lessonDateTime(day).date);
                }}
                style={[s.quickButton, { backgroundColor: colors.pale }]}
              >
                <Text style={{ color: colors.blue, fontWeight: '600' }}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      <Text style={[s.label, { color: colors.ink }]}>Время занятия</Text>
      <View style={s.timeRow}>
        <View style={s.timeField}>
          <label
            htmlFor={`${id}-hour`}
            style={{
              color: colors.muted,
              fontSize: 12,
              fontFamily: controlFont,
            }}
          >
            Часы
          </label>
          <select
            id={`${id}-hour`}
            aria-label="Часы"
            disabled={disabled}
            value={hour}
            onChange={(event) =>
              onChange({ ...value, time: `${event.target.value}:${minute}` })
            }
            style={{ ...selectStyle, width: '100%' }}
          >
            {Array.from({ length: 24 }, (_, index) => two(index)).map(
              (item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ),
            )}
          </select>
        </View>
        <Text style={[s.colon, { color: colors.muted }]}>:</Text>
        <View style={s.timeField}>
          <label
            htmlFor={`${id}-minute`}
            style={{
              color: colors.muted,
              fontSize: 12,
              fontFamily: controlFont,
            }}
          >
            Минуты
          </label>
          <select
            id={`${id}-minute`}
            aria-label="Минуты"
            disabled={disabled}
            value={minute}
            onChange={(event) =>
              onChange({ ...value, time: `${hour}:${event.target.value}` })
            }
            style={{ ...selectStyle, width: '100%' }}
          >
            {Array.from({ length: 60 }, (_, index) => two(index)).map(
              (item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ),
            )}
          </select>
        </View>
        <Text
          style={{
            color: colors.muted,
            fontSize: 12,
            alignSelf: 'flex-end',
            paddingBottom: 16,
          }}
        >
          24 часа
        </Text>
      </View>
      <Text style={[s.hint, { color: colors.muted }]}>
        {lessonTimezoneLabel()}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  field: { gap: 9 },
  label: { fontSize: 14, fontWeight: '600' },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    padding: 14,
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 52,
  },
  dateText: { fontSize: 16 },
  calendar: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  navigation: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  monthSelectors: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  arrow: {
    minWidth: 34,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowText: { fontSize: 28, lineHeight: 32 },
  monthCaption: {
    fontSize: 12,
    textAlign: 'center',
    textTransform: 'capitalize',
  },
  week: { flexDirection: 'row' },
  weekday: {
    width: '14.285714%',
    textAlign: 'center',
    fontSize: 12,
    paddingVertical: 8,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.285714%', padding: 2, height: 44 },
  day: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  quickButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  timeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  timeField: { width: 95, gap: 5 },
  colon: { fontSize: 20, marginTop: 18 },
  hint: { fontSize: 12, lineHeight: 18 },
  disabled: { opacity: 0.5 },
});
