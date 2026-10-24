import { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import {
  initialLessonDateTime,
  lessonDateLabel,
  lessonDateTime,
  lessonTimezoneLabel,
  parseLessonDateTime,
  type LessonDateTime,
} from '../core/lesson-date';
import { useAppTheme } from '../core/theme';
import { Button, Row } from './ui';

export type DateTimeFieldProps = {
  value: LessonDateTime;
  onChange: (value: LessonDateTime) => void;
  disabled?: boolean;
};

type PickerMode = 'date' | 'time';

export function DateTimeField({
  value,
  onChange,
  disabled,
}: DateTimeFieldProps) {
  const { colors, mode: themeMode } = useAppTheme();
  const [picker, setPicker] = useState<PickerMode | null>(null);
  const [draft, setDraft] = useState(new Date());

  const commit = (selected: Date, mode: PickerMode) => {
    const next = lessonDateTime(selected);
    onChange(
      mode === 'date'
        ? { ...value, date: next.date }
        : { ...value, time: next.time },
    );
  };
  const open = (mode: PickerMode) => {
    const current =
      parseLessonDateTime(value) ??
      parseLessonDateTime(initialLessonDateTime())!;
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: current,
        mode,
        is24Hour: true,
        minimumDate: mode === 'date' ? new Date(2000, 0, 1) : undefined,
        maximumDate: mode === 'date' ? new Date(2100, 11, 31) : undefined,
        firstDayOfWeek: 1,
        positiveButton: { label: 'Выбрать' },
        negativeButton: { label: 'Отмена' },
        onValueChange: (_event, selected) => commit(selected, mode),
      });
      return;
    }
    setDraft(current);
    setPicker(mode);
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
        disabled={disabled}
        onPress={() => open('date')}
        style={[s.control, controlStyle, disabled && s.disabled]}
      >
        <Text style={[s.value, { color: colors.ink }]}>
          {lessonDateLabel(value.date)}
        </Text>
        <Text style={{ color: colors.blue }}>Календарь ↓</Text>
      </Pressable>
      <Text style={[s.label, { color: colors.ink }]}>Время занятия</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Выбрать время: ${value.time}`}
        disabled={disabled}
        onPress={() => open('time')}
        style={[s.control, controlStyle, disabled && s.disabled]}
      >
        <Text style={[s.value, { color: colors.ink }]}>{value.time}</Text>
        <Text style={{ color: colors.muted }}>24 часа ↓</Text>
      </Pressable>
      <Text style={[s.hint, { color: colors.muted }]}>
        {lessonTimezoneLabel()}
      </Text>
      <Modal
        visible={picker !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPicker(null)}
      >
        <View style={s.overlay}>
          <View
            accessibilityViewIsModal
            style={[
              s.dialog,
              { backgroundColor: colors.surface, borderColor: colors.line },
            ]}
          >
            <Text
              accessibilityRole="header"
              style={[s.dialogTitle, { color: colors.ink }]}
            >
              {picker === 'date' ? 'Выберите дату' : 'Выберите время'}
            </Text>
            {picker && (
              <DateTimePicker
                value={draft}
                mode={picker}
                display="spinner"
                locale="ru-RU"
                is24Hour
                themeVariant={themeMode}
                textColor={colors.ink}
                accentColor={colors.blue}
                minimumDate={
                  picker === 'date' ? new Date(2000, 0, 1) : undefined
                }
                maximumDate={
                  picker === 'date' ? new Date(2100, 11, 31) : undefined
                }
                onValueChange={(_event, selected) => setDraft(selected)}
                style={s.spinner}
              />
            )}
            <Row>
              <Button
                title="Выбрать"
                onPress={() => {
                  if (picker) commit(draft, picker);
                  setPicker(null);
                }}
              />
              <Button
                title="Отмена выбора"
                variant="secondary"
                onPress={() => setPicker(null)}
              />
            </Row>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  field: { gap: 9 },
  label: { fontSize: 14, fontWeight: '600' },
  control: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  value: { fontSize: 16 },
  hint: { fontSize: 12, lineHeight: 18 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.48)',
    justifyContent: 'center',
    padding: 20,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    padding: 20,
    gap: 16,
    borderRadius: 18,
    borderWidth: 1,
  },
  dialogTitle: { fontSize: 19, fontWeight: '600' },
  spinner: { alignSelf: 'stretch' },
  disabled: { opacity: 0.5 },
});
