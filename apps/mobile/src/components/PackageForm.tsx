import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { errorMessage } from '../core/api';
import { rublesToKopecks } from '../core/format';
import { Body, Button, FormInput, Notice, Row, Stack } from './ui';
const schema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Введите название пакета')
    .max(120, 'Не более 120 символов'),
  totalLessons: z
    .string()
    .regex(/^\d+$/, 'Введите целое число')
    .refine((v) => Number(v) >= 1 && Number(v) <= 1000, 'От 1 до 1000 занятий'),
  price: z
    .string()
    .regex(
      /^\d+(?:[.,]\d{1,2})?$/,
      'Введите сумму в рублях, например 12000 или 12000,50',
    )
    .refine(
      (v) => rublesToKopecks(v) <= 1000000000,
      'Стоимость до 10 000 000 ₽',
    ),
});
type Values = z.infer<typeof schema>;
export interface PackageInitial {
  title: string;
  totalLessons: number;
  priceKopecks: number;
}
export function PackageForm({
  onSave,
  onCancel,
  initial,
}: {
  initial?: PackageInitial;
  onSave: (values: {
    title: string;
    totalLessons: number;
    priceKopecks: number;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: initial?.title ?? '',
      totalLessons: String(initial?.totalLessons ?? 8),
      price: initial ? String(initial.priceKopecks / 100) : '',
    },
  });
  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      await onSave({
        title: values.title,
        totalLessons: Number(values.totalLessons),
        priceKopecks: rublesToKopecks(values.price),
      });
    } catch (problem) {
      setError(errorMessage(problem));
    }
  });
  return (
    <Stack>
      <FormInput
        control={control}
        name="title"
        label="Название пакета"
        placeholder="Например, Английский · 8 занятий"
        editable={!isSubmitting}
      />
      <FormInput
        control={control}
        name="totalLessons"
        label="Количество занятий"
        keyboardType="number-pad"
        editable={!isSubmitting}
      />
      <FormInput
        control={control}
        name="price"
        label="Общая стоимость, ₽"
        placeholder="12000"
        keyboardType="decimal-pad"
        editable={!isSubmitting}
      />
      <Body muted>
        Размер и стоимость пакета фиксируются при создании. Следующую покупку
        можно оформить новым пакетом. Новый пакет ожидает оплаты — подтвердите
        получение денег отдельно.
      </Body>
      {error && <Notice message={error} />}
      <Row>
        <Button
          title="Создать пакет"
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
