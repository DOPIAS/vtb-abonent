import { useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useSession } from '../../../src/core/auth';
import { useAppTheme } from '../../../src/core/theme';
import { errorMessage, request } from '../../../src/core/api';
import { Detail, Lesson } from '../../../src/core/types';
import { money } from '../../../src/core/format';
import {
  Back,
  Body,
  Button,
  Card,
  Failure,
  Heading,
  Loading,
  Notice,
  Page,
  Row,
  SectionTitle,
  Stack,
} from '../../../src/components/ui';
import {
  SubscriptionSummary,
  LessonHistory,
} from '../../../src/components/Subscription';
import { LessonForm } from '../../../src/components/LessonForm';
import { useConfirmation } from '../../../src/components/Confirm';
export default function PackageScreen() {
  const { colors } = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useSession();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['package', id],
    queryFn: ({ signal }) =>
      request<Detail>(`/packages/${id}`, { token, signal }),
  });
  const [adding, setAdding] = useState(false);
  const [rescheduling, setRescheduling] = useState<Lesson | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmation();
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['package', id] }),
      queryClient.invalidateQueries({ queryKey: ['client'] }),
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
  };
  const action = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      await refresh();
      setNotice(success);
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };
  const updateLesson = async (
    lesson: Lesson,
    body: {
      action: 'complete' | 'cancel' | 'restore' | 'reschedule';
      scheduledAt?: string;
      confirmed?: boolean;
    },
  ) => {
    const result = await request<Detail>(`/lessons/${lesson.id}`, {
      token,
      method: 'PATCH',
      body,
    });
    queryClient.setQueryData(['package', id], result);
  };
  if (detail.isPending)
    return (
      <Page navigation="clients">
        <Back href="/clients" title="Клиенты" />
        <Loading />
      </Page>
    );
  if (detail.isError)
    return (
      <Page navigation="clients">
        <Back href="/clients" title="Клиенты" />
        <Failure error={detail.error} retry={() => void detail.refetch()} />
      </Page>
    );
  const pack = detail.data.package;
  const lessonActions = (lesson: Lesson) => (
    <Stack>
      {lesson.status === 'scheduled' && (
        <Row>
          <Button
            title="Проведено"
            disabled={
              busy ||
              pack.paymentStatus !== 'paid' ||
              pack.remainingLessons <= 0
            }
            onPress={() =>
              confirm({
                title: 'Занятие проведено?',
                message: 'Остаток абонемента уменьшится на одно занятие.',
                confirmLabel: 'Да, проведено',
                run: () =>
                  action(
                    () => updateLesson(lesson, { action: 'complete' }),
                    'Проведение отмечено. Остаток обновлён сервером.',
                  ),
              })
            }
          />
          <Button
            title="Перенести"
            variant="secondary"
            disabled={busy}
            onPress={() => {
              setRescheduling(lesson);
              setAdding(false);
            }}
          />
          <Button
            title="Отменить занятие"
            variant="link"
            disabled={busy}
            onPress={() =>
              confirm({
                title: 'Отменить занятие?',
                message:
                  'Занятие останется в истории со статусом «Отменено». Остаток не изменится.',
                confirmLabel: 'Отменить занятие',
                danger: true,
                run: () =>
                  action(
                    () => updateLesson(lesson, { action: 'cancel' }),
                    'Занятие отменено. Остаток сохранён.',
                  ),
              })
            }
          />
        </Row>
      )}
      {lesson.status === 'completed' && (
        <View style={{ alignSelf: 'flex-start' }}>
          <Button
            title="Исправить отметку о проведении"
            variant="link"
            disabled={busy}
            onPress={() =>
              confirm({
                title: 'Восстановить занятие?',
                message:
                  'Подтвердите, что отметка о проведении ошибочна. Занятие вернётся в запланированные, а остаток увеличится на одно.',
                confirmLabel: 'Да, восстановить',
                run: () =>
                  action(
                    () =>
                      updateLesson(lesson, {
                        action: 'restore',
                        confirmed: true,
                      }),
                    'Отметка исправлена. Занятие восстановлено.',
                  ),
              })
            }
          />
        </View>
      )}
      {rescheduling?.id === lesson.id && (
        <LessonForm
          key={lesson.id}
          initial={lesson.scheduledAt}
          reschedule
          onCancel={() => setRescheduling(null)}
          onSave={async (scheduledAt) => {
            await updateLesson(lesson, { action: 'reschedule', scheduledAt });
            await refresh();
            setRescheduling(null);
            setNotice('Занятие перенесено. Остаток сохранён.');
          }}
        />
      )}
    </Stack>
  );
  return (
    <Page navigation="clients">
      <Back href={`/clients/${pack.clientId}`} title="К клиенту" />
      <Heading
        eyebrow="Управление абонементом"
        title="Всё о занятиях"
        subtitle="Изменения сохраняются на сервере и отражаются по клиентской ссылке."
      />
      <SubscriptionSummary data={pack} />
      {error && <Notice message={error} />}
      {notice && <Notice message={notice} success />}
      {pack.paymentStatus === 'pending' && (
        <Card>
          <SectionTitle>Подтвердите полученную оплату</SectionTitle>
          <Body>
            Полная стоимость пакета — {money(pack.priceKopecks)}. Подтверждение
            фиксирует получение денег и открывает списание занятий.
          </Body>
          <Body muted>
            Это ручной учёт оплаты. Деньги через приложение не переводятся.
          </Body>
          <View style={{ alignSelf: 'flex-start' }}>
            <Button
              title="Подтвердить полную оплату"
              busy={busy}
              onPress={() =>
                confirm({
                  title: 'Оплата получена полностью?',
                  message: `Вы подтверждаете получение ${money(pack.priceKopecks)} за ${pack.totalLessons} занятий.`,
                  confirmLabel: 'Да, деньги получены',
                  run: () =>
                    action(
                      () =>
                        request(`/packages/${id}/payment`, {
                          token,
                          method: 'POST',
                          body: {},
                        }),
                      'Полная оплата подтверждена.',
                    ),
                })
              }
            />
          </View>
        </Card>
      )}
      <Card>
        <Row>
          <View style={{ flex: 1, minWidth: 200 }}>
            <SectionTitle>Планируйте следующий шаг</SectionTitle>
            <Body muted>Перенос и отмена не расходуют занятия.</Body>
          </View>
          <Button
            title="+ Добавить занятие"
            disabled={busy}
            onPress={() => {
              setAdding(true);
              setRescheduling(null);
            }}
          />
        </Row>
        {adding && (
          <LessonForm
            onCancel={() => setAdding(false)}
            onSave={async (scheduledAt) => {
              await request(`/packages/${id}/lessons`, {
                token,
                method: 'POST',
                body: { scheduledAt },
              });
              await refresh();
              setAdding(false);
              setNotice('Занятие запланировано.');
            }}
          />
        )}
        {pack.paymentStatus === 'paid' && pack.remainingLessons <= 0 && (
          <Body muted>
            Все оплаченные занятия проведены. Оформите новый пакет для следующей
            покупки.
          </Body>
        )}
      </Card>
      <LessonHistory
        lessons={detail.data.lessons}
        renderActions={lessonActions}
      />
      <Card>
        <SectionTitle>Клиентская ссылка</SectionTitle>
        <Body muted>
          Клиент увидит только этот абонемент и историю занятий. Регистрация и
          установка приложения не нужны.
        </Body>
        {shareUrl && (
          <View style={{ gap: 12 }}>
            <Text
              selectable
              accessibilityLabel="Клиентская ссылка"
              style={{ color: colors.blue, fontSize: 14, lineHeight: 23 }}
            >
              {shareUrl}
            </Text>
            <Button
              title="Копировать ссылку"
              variant="secondary"
              disabled={busy}
              onPress={() => {
                void Clipboard.setStringAsync(shareUrl)
                  .then(() => {
                    setError(null);
                    setNotice('Ссылка скопирована. Отправьте её клиенту.');
                  })
                  .catch(() =>
                    setError(
                      'Не удалось скопировать автоматически. Выделите и скопируйте ссылку выше.',
                    ),
                  );
              }}
            />
          </View>
        )}
        <Body muted>
          Новая ссылка заменит предыдущую. После закрытия страницы можно создать
          новую ссылку.
        </Body>
        <Row>
          <Button
            title={shareUrl ? 'Создать новую ссылку' : 'Создать ссылку'}
            busy={busy}
            onPress={() =>
              confirm({
                title: 'Создать клиентскую ссылку?',
                message:
                  'Предыдущая ссылка этого пакета перестанет работать. Доступ по новой ссылке будет только для просмотра.',
                confirmLabel: 'Создать ссылку',
                run: () =>
                  action(async () => {
                    const result = await request<{
                      url: string;
                      token: string;
                    }>(`/packages/${id}/share-link`, {
                      token,
                      method: 'POST',
                      body: {},
                    });
                    setShareUrl(result.url);
                  }, 'Ссылка создана. Скопируйте и отправьте её клиенту.'),
              })
            }
          />
          <Button
            title="Отозвать доступ"
            variant="danger"
            disabled={busy}
            onPress={() =>
              confirm({
                title: 'Отозвать клиентскую ссылку?',
                message:
                  'Все ранее созданные ссылки этого пакета перестанут работать. Позже можно создать новую.',
                confirmLabel: 'Отозвать доступ',
                danger: true,
                run: () =>
                  action(async () => {
                    await request(`/packages/${id}/share-link`, {
                      token,
                      method: 'DELETE',
                    });
                    setShareUrl(null);
                  }, 'Клиентский доступ отозван.'),
              })
            }
          />
        </Row>
      </Card>
      {dialog}
    </Page>
  );
}
