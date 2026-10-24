import { useRef, useState } from 'react';
import { errorMessage } from '../core/api';
import {
  initialLessonDateTime,
  parseLessonDateTime,
} from '../core/lesson-date';
import { DateTimeField } from './DateTimeField';
import { Button, Notice, Row, Stack } from './ui';

export function LessonForm({
  initial,
  reschedule = false,
  onSave,
  onCancel,
}: {
  initial?: string;
  reschedule?: boolean;
  onSave: (scheduledAt: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(() => initialLessonDateTime(initial));
  const original = useRef(value);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const submitting = useRef(false);
  async function submit() {
    if (submitting.current) return;
    const selected = parseLessonDateTime(value);
    if (!selected) {
      setError('Это местное время недоступно. Выберите другую дату или время.');
      return;
    }
    setError(null);
    submitting.current = true;
    setSubmitting(true);
    try {
      const unchanged =
        initial &&
        value.date === original.current.date &&
        value.time === original.current.time &&
        !Number.isNaN(new Date(initial).getTime());
      await onSave(
        unchanged ? new Date(initial).toISOString() : selected.toISOString(),
      );
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      submitting.current = false;
      setSubmitting(false);
    }
  }
  return (
    <Stack>
      <DateTimeField
        value={value}
        onChange={(next) => {
          setValue(next);
          setError(null);
        }}
        disabled={isSubmitting}
      />
      {error && <Notice message={error} />}
      <Row>
        <Button
          title={reschedule ? 'Сохранить перенос' : 'Запланировать занятие'}
          busy={isSubmitting}
          onPress={() => void submit()}
        />
        <Button
          title="Отмена"
          variant="secondary"
          disabled={isSubmitting}
          onPress={onCancel}
        />
      </Row>
    </Stack>
  );
}
