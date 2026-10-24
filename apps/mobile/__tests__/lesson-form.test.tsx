import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { LessonForm } from '../src/components/LessonForm';
import type { DateTimeFieldProps } from '../src/components/DateTimeField.native';
import { lessonDateTime, parseLessonDateTime } from '../src/core/lesson-date';

jest.mock('expo-router', () => ({ router: {} }));
// Form tests exercise controlled selection and submission. The actual web calendar
// is covered separately with the DOM renderer; native dialogs are tested below.
jest.mock('../src/components/DateTimeField', () => {
  const React = jest.requireActual('react');
  const { View, Pressable, Text, TextInput } =
    jest.requireActual('react-native');
  return {
    DateTimeField: ({ value, onChange }: DateTimeFieldProps) =>
      React.createElement(
        View,
        null,
        React.createElement(
          Pressable,
          {
            accessibilityRole: 'button',
            accessibilityLabel: `Выбрать дату: ${value.date}`,
            onPress: () => onChange({ ...value, date: '2026-11-05' }),
          },
          React.createElement(Text, null, value.date),
        ),
        React.createElement(TextInput, {
          accessibilityLabel: 'Часы',
          value: value.time.split(':')[0],
          onChangeText: (hour: string) =>
            onChange({ ...value, time: `${hour}:${value.time.split(':')[1]}` }),
        }),
        React.createElement(TextInput, {
          accessibilityLabel: 'Минуты',
          value: value.time.split(':')[1],
          onChangeText: (minute: string) =>
            onChange({
              ...value,
              time: `${value.time.split(':')[0]}:${minute}`,
            }),
        }),
      ),
  };
});
jest.mock('@react-native-community/datetimepicker', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: (props: object) =>
      React.createElement(View, { ...props, testID: 'native-date-picker' }),
    DateTimePickerAndroid: { open: jest.fn() },
  };
});

const { DateTimeField: NativeDateTimeField } = jest.requireActual<
  typeof import('../src/components/DateTimeField.native')
>('../src/components/DateTimeField.native');

const initialDate = new Date(2026, 9, 25, 14, 30);
const initial = initialDate.toISOString();

async function selectDateAndTime() {
  await fireEvent.press(screen.getByRole('button', { name: /Выбрать дату:/ }));
  await fireEvent.changeText(screen.getByLabelText('Часы'), '16');
  await fireEvent.changeText(screen.getByLabelText('Минуты'), '45');
}

it('submits the picker selection as UTC in the device timezone', async () => {
  const save = jest.fn().mockResolvedValue(undefined);
  await render(
    <LessonForm initial={initial} onSave={save} onCancel={jest.fn()} />,
  );
  await selectDateAndTime();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Запланировать занятие' }),
  );
  expect(save).toHaveBeenCalledWith(
    new Date(2026, 10, 5, 16, 45).toISOString(),
  );
});

it('preserves the exact existing appointment when rescheduling without changes', async () => {
  const save = jest.fn().mockResolvedValue(undefined);
  const existing = '2026-10-25T04:30:12.345Z';
  await render(
    <LessonForm
      initial={existing}
      reschedule
      onSave={save}
      onCancel={jest.fn()}
    />,
  );
  const local = lessonDateTime(new Date(existing));
  expect(screen.getByLabelText('Часы').props.value).toBe(
    local.time.split(':')[0],
  );
  expect(screen.getByLabelText('Минуты').props.value).toBe(
    local.time.split(':')[1],
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Сохранить перенос' }),
  );
  expect(save).toHaveBeenCalledWith(existing);
});

it('keeps the selected date and time after an API error so the user can retry', async () => {
  const save = jest
    .fn()
    .mockRejectedValueOnce(new Error('Не удалось сохранить'))
    .mockResolvedValueOnce(undefined);
  await render(
    <LessonForm
      initial={initial}
      reschedule
      onSave={save}
      onCancel={jest.fn()}
    />,
  );
  await selectDateAndTime();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Сохранить перенос' }),
  );
  expect(await screen.findByText('Не удалось сохранить')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Выбрать дату: 2026-11-05' }),
  ).toBeTruthy();
  expect(screen.getByLabelText('Часы').props.value).toBe('16');
  expect(screen.getByLabelText('Минуты').props.value).toBe('45');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Сохранить перенос' }),
  );
  expect(save).toHaveBeenNthCalledWith(
    2,
    new Date(2026, 10, 5, 16, 45).toISOString(),
  );
});

it('cancels the lesson form without submitting the chosen date', async () => {
  const save = jest.fn();
  const cancel = jest.fn();
  await render(
    <LessonForm initial={initial} onSave={save} onCancel={cancel} />,
  );
  await selectDateAndTime();
  await fireEvent.press(screen.getByRole('button', { name: 'Отмена' }));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
});

it('leaves the original date unchanged when the native iOS picker is cancelled', async () => {
  const change = jest.fn();
  await render(
    <NativeDateTimeField
      value={{ date: '2026-10-25', time: '14:30' }}
      onChange={change}
    />,
  );
  await fireEvent.press(screen.getByRole('button', { name: /Выбрать дату:/ }));
  await fireEvent(
    screen.getByTestId('native-date-picker'),
    'valueChange',
    {},
    new Date(2026, 10, 5),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Отмена выбора' }));
  expect(change).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Выбрать дату: 25 октября 2026 г.' }),
  ).toBeTruthy();
});

it('commits the native time only after confirmation and preserves the selected day', async () => {
  const change = jest.fn();
  await render(
    <NativeDateTimeField
      value={{ date: '2026-10-25', time: '14:30' }}
      onChange={change}
    />,
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Выбрать время: 14:30' }),
  );
  await fireEvent(
    screen.getByTestId('native-date-picker'),
    'valueChange',
    {},
    new Date(2026, 9, 25, 17, 45),
  );
  expect(change).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Выбрать' }));
  expect(change).toHaveBeenCalledWith({ date: '2026-10-25', time: '17:45' });
});

it('uses the Android system picker and ignores dismissal without a confirmed value', async () => {
  const os = Platform.OS;
  Object.defineProperty(Platform, 'OS', {
    value: 'android',
    configurable: true,
  });
  try {
    const change = jest.fn();
    await render(
      <NativeDateTimeField
        value={{ date: '2026-10-25', time: '14:30' }}
        onChange={change}
      />,
    );
    await fireEvent.press(
      screen.getByRole('button', { name: /Выбрать дату:/ }),
    );
    const options = jest.mocked(DateTimePickerAndroid.open).mock.calls[0]![0];
    expect(options.is24Hour).toBe(true);
    expect(options.value).toEqual(initialDate);
    expect(change).not.toHaveBeenCalled();
    await act(async () =>
      options.onValueChange!(
        { nativeEvent: { timestamp: 0, utcOffset: 0 } },
        new Date(2026, 10, 5, 14, 30),
      ),
    );
    expect(change).toHaveBeenCalledWith({ date: '2026-11-05', time: '14:30' });
  } finally {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  }
});

it('rejects impossible days rather than silently rolling to another month', () => {
  expect(parseLessonDateTime({ date: '2026-02-30', time: '14:30' })).toBeNull();
  expect(parseLessonDateTime({ date: '2026-10-25', time: '24:30' })).toBeNull();
  expect(parseLessonDateTime({ date: '2028-02-29', time: '14:30' })).toEqual(
    new Date(2028, 1, 29, 14, 30),
  );
});

it('rejects the skipped DST time when run in America/New_York', () => {
  if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'America/New_York')
    return;
  expect(parseLessonDateTime({ date: '2026-03-08', time: '02:30' })).toBeNull();
  expect(
    parseLessonDateTime({ date: '2026-03-08', time: '03:30' })?.toISOString(),
  ).toBe('2026-03-08T07:30:00.000Z');
});
