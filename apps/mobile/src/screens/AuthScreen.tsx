import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSession } from '../core/auth';
import { errorMessage } from '../core/api';
import {
  Body,
  Button,
  Card,
  FormInput,
  Heading,
  Loading,
  Notice,
  Page,
  Row,
} from '../components/ui';
const schema = z.object({
  email: z.string().trim().email('Введите корректный email'),
  password: z
    .string()
    .min(1, 'Введите пароль')
    .max(128, 'Не более 128 символов'),
  name: z.string().max(120, 'Не более 120 символов'),
});
type Values = z.infer<typeof schema>;
export function AuthScreen({ mode }: { mode: 'login' | 'register' }) {
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  const registration = mode === 'register';
  const {
    control,
    handleSubmit,
    setError: setFieldError,
    formState: { isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', name: '' },
  });
  if (session.loading)
    return (
      <Page>
        <Loading />
      </Page>
    );
  if (session.token) return <Redirect href="/dashboard" />;
  const submit = handleSubmit(async (values) => {
    setError(null);
    if (registration && !values.name.trim()) {
      setFieldError('name', { message: 'Введите ваше имя' });
      return;
    }
    if (registration && values.password.length < 10) {
      setFieldError('password', { message: 'Не менее 10 символов' });
      return;
    }
    try {
      await session.authenticate(mode, {
        email: values.email.trim(),
        password: values.password,
        ...(registration ? { name: values.name.trim() } : {}),
      });
      router.replace('/dashboard');
    } catch (problem) {
      setError(errorMessage(problem));
    }
  });
  return (
    <Page>
      <View style={styles.layout}>
        <View style={styles.intro}>
          <Heading
            eyebrow="Для тех, кто учит"
            title={'Все занятия.\nВ одном месте.'}
            subtitle="Клиенты, оплата и остаток занятий — в спокойном ритме вашей работы."
          />
          <Body muted>
            Поделитесь личной ссылкой: клиент сам увидит актуальный абонемент.
          </Body>
        </View>
        <View style={styles.form}>
          <Card>
            <Heading
              title={registration ? 'Создать аккаунт' : 'С возвращением'}
              subtitle={
                registration
                  ? 'Начните вести клиентов и занятия.'
                  : 'Войдите в кабинет преподавателя.'
              }
            />
            {registration && (
              <FormInput
                control={control}
                name="name"
                label="Ваше имя"
                placeholder="Как к вам обращаться"
                autoComplete="name"
                maxLength={120}
                editable={!isSubmitting}
              />
            )}
            <FormInput
              control={control}
              name="email"
              label="Email"
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              editable={!isSubmitting}
            />
            <FormInput
              control={control}
              name="password"
              label="Пароль"
              placeholder={
                registration ? 'Не менее 10 символов' : 'Введите пароль'
              }
              secureTextEntry
              autoCapitalize="none"
              autoComplete={registration ? 'new-password' : 'current-password'}
              textContentType={registration ? 'newPassword' : 'password'}
              editable={!isSubmitting}
              onSubmitEditing={() => void submit()}
            />
            {error && <Notice message={error} />}
            <Button
              title={registration ? 'Зарегистрироваться' : 'Войти'}
              busy={isSubmitting}
              onPress={() => void submit()}
            />
            <Row>
              <Body muted>
                {registration ? 'Уже есть аккаунт?' : 'Впервые здесь?'}
              </Body>
              <Button
                title={registration ? 'Войти' : 'Создать аккаунт'}
                variant="link"
                disabled={isSubmitting}
                onPress={() =>
                  router.replace(registration ? '/login' : '/register')
                }
              />
            </Row>
          </Card>
        </View>
      </View>
    </Page>
  );
}
const styles = StyleSheet.create({
  layout: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 40,
    paddingVertical: 30,
  },
  intro: { flex: 1, minWidth: 250, gap: 24, paddingVertical: 20 },
  form: { flex: 1, minWidth: 270, maxWidth: 460 },
});
