import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ApiError, request } from '../core/api';
import { PublicDetail } from '../core/types';
import { dateTime } from '../core/format';
import { nextScheduledLesson } from '../core/next-lesson';
import {
  Body,
  Button,
  Card,
  Failure,
  Heading,
  Loading,
  Page,
  Row,
  SectionTitle,
} from '../components/ui';
import { LessonHistory, SubscriptionSummary } from '../components/Subscription';
export function PublicScreen({ token }: { token: string }) {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.title = 'Ваш абонемент · Абонент';
    let meta = document.querySelector<HTMLMetaElement>('meta[name="referrer"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'referrer';
      document.head.appendChild(meta);
    }
    meta.content = 'no-referrer';
  }, []);
  const detail = useQuery({
    queryKey: ['public-subscription', token],
    queryFn: ({ signal }) =>
      request<PublicDetail>(
        `/public/subscriptions/${encodeURIComponent(token)}`,
        { signal },
      ),
    enabled: !!token,
    refetchInterval: 15000,
    refetchOnWindowFocus: 'always',
    staleTime: 0,
  });
  const invalid =
    !token ||
    (detail.isError &&
      detail.error instanceof ApiError &&
      (detail.error.status === 404 || detail.error.status === 400));
  if (invalid)
    return (
      <Page publicPage>
        <Card>
          <Heading
            eyebrow="Клиентская ссылка"
            title="Ссылка больше не действует"
            subtitle="Она могла быть отозвана или заменена. Попросите преподавателя прислать новую ссылку на ваш абонемент."
          />
        </Card>
      </Page>
    );
  if (detail.isPending)
    return (
      <Page publicPage>
        <Loading message="Загружаем ваш абонемент…" />
      </Page>
    );
  if (detail.isError)
    return (
      <Page publicPage>
        <Heading title="Не удалось обновить абонемент" />
        <Failure error={detail.error} retry={() => void detail.refetch()} />
      </Page>
    );
  const nextLesson = nextScheduledLesson(detail.data.lessons);
  return (
    <Page publicPage>
      <Heading
        eyebrow="Ваш личный абонемент"
        title="Занимайтесь с удовольствием"
        subtitle="Всё, что нужно знать о ваших занятиях, на одной странице."
      />
      <SubscriptionSummary data={detail.data.package} />
      <Card>
        <SectionTitle>Следующее занятие</SectionTitle>
        <Body>
          {nextLesson
            ? dateTime(nextLesson.scheduledAt)
            : 'Пока не запланировано'}
        </Body>
        <Body muted>
          {nextLesson
            ? 'Время указано в часовом поясе вашего устройства. Если планы изменились, обсудите перенос с преподавателем.'
            : 'Договоритесь с преподавателем о следующей встрече. Когда он добавит занятие, дата появится здесь.'}
        </Body>
      </Card>
      <Row>
        <Body muted>
          {detail.isFetching
            ? 'Обновляем данные…'
            : 'Данные обновляются автоматически каждые 15 секунд.'}
        </Body>
        <Button
          title="Обновить"
          variant="link"
          disabled={detail.isFetching}
          onPress={() => void detail.refetch()}
        />
      </Row>
      <LessonHistory lessons={detail.data.lessons} />
      <Card>
        <Body muted>
          Вопросы об оплате или расписании можно обсудить с преподавателем. Эта
          страница доступна только для просмотра.
        </Body>
      </Card>
    </Page>
  );
}
