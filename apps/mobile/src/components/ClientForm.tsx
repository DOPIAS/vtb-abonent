import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { errorMessage } from '../core/api';
import { normalizeRussianPhone, PHONE_ERROR } from '../core/phone';
import { Button, FormInput, Input, Notice, Row, Stack } from './ui';
const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Введите имя клиента')
    .max(120, 'Не более 120 символов'),
  contact: z.string().trim().max(250, 'Не более 250 символов'),
  phone: z.string().refine((value) => normalizeRussianPhone(value) !== null, {
    message: PHONE_ERROR,
  }),
});
export type ClientValues = z.infer<typeof schema>;
export function ClientForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: ClientValues;
  onSave: (values: ClientValues) => Promise<void>;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ClientValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', contact: '', phone: '', ...initial },
    mode: 'onBlur',
  });
  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      await onSave({ ...values, phone: normalizeRussianPhone(values.phone)! });
    } catch (problem) {
      setError(errorMessage(problem));
    }
  });
  return (
    <Stack>
      <FormInput
        control={control}
        name="name"
        label="Имя клиента"
        placeholder="Например, Анна Смирнова"
        autoComplete="name"
        editable={!isSubmitting}
      />
      <FormInput
        control={control}
        name="contact"
        label="Другой контакт · необязательно"
        placeholder="Email, мессенджер или удобный способ связи"
        editable={!isSubmitting}
      />
      <Controller
        control={control}
        name="phone"
        render={({ field, fieldState }) => (
          <Input
            label="Телефон · необязательно"
            placeholder="+7 (999) 123-45-67"
            hint="Российский номер: +7 (999) 123-45-67. Можно ввести с 8 или без кода страны."
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={() => {
              const normalized = normalizeRussianPhone(field.value);
              if (normalized !== null) field.onChange(normalized);
              field.onBlur();
            }}
            error={fieldState.error?.message}
            editable={!isSubmitting}
          />
        )}
      />
      {error && <Notice message={error} />}
      <Row>
        <Button
          title="Сохранить клиента"
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
