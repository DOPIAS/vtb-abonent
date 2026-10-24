import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '../../src/core/auth';
import { errorMessage, request } from '../../src/core/api';
import { Dashboard } from '../../src/core/types';
import { dateTime, money } from '../../src/core/format';
import { ThemeColors, useAppTheme } from '../../src/core/theme';
import {
  Badge,
  Body,
  Button,
  Card,
  Empty,
  Failure,
  Heading,
  Loading,
  Notice,
  Page,
  Row,
  SectionTitle,
} from '../../src/components/ui';
import { useConfirmation } from '../../src/components/Confirm';

export default function DashboardScreen() {
  const { token, user, logout } = useSession();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmation();
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: ({ signal }) =>
      request<Dashboard>('/dashboard', { token, signal }),
  });
  const doLogout = async () => {
    setLogoutBusy(true);
    setError(null);
    try {
      await logout();
      router.replace('/login');
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setLogoutBusy(false);
    }
  };
  const totals = dashboard.data?.totals;
  return (
    <Page navigation="dashboard">
      <Heading
        eyebrow={`Здравствуйте, ${user?.name || 'преподаватель'}`}
        title="Ваша практика — на виду"
        subtitle="Оплата, оставшиеся занятия и следующий шаг по каждому клиенту."
        action={
          <Button
            title="Выйти"
            variant="secondary"
            busy={logoutBusy}
            onPress={() =>
              confirm({
                title: 'Выйти из кабинета?',
                message: 'Сессия завершится на этом устройстве.',
                confirmLabel: 'Выйти',
                run: doLogout,
              })
            }
          />
        }
      />
      {error && <Notice message={error} />}
      {dashboard.isPending ? (
        <Loading message="Собираем обзор вашей практики…" />
      ) : dashboard.isError ? (
        <Failure
          error={dashboard.error}
          retry={() => void dashboard.refetch()}
        />
      ) : totals && totals.clientCount === 0 ? (
        <Card>
          <Empty
            title="Начните с первого клиента"
            detail="Создайте пакет и запланируйте занятие. Здесь появятся оплата, расписание и клиенты, которым пора предложить новый пакет."
          />
          <Button
            title="Добавить первого клиента"
            onPress={() => router.push('/clients')}
          />
        </Card>
      ) : dashboard.data && totals ? (
        <>
          <View style={styles.metrics}>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Подтверждено оплат</Text>
              <Text style={styles.metricValue}>
                {money(totals.confirmedPaymentsKopecks)}
              </Text>
              <Body muted>
                Оплаченных пакетов: {totals.paidPackageCount}. Получение денег
                вы отмечаете вручную; банковской проверки нет.
              </Body>
            </View>
            <View style={[styles.metric, styles.highlight]}>
              <Text style={styles.metricLabel}>
                Стоимость оставшихся занятий
              </Text>
              <Text style={styles.metricValue}>
                {money(totals.remainingValueKopecks)}
              </Text>
              <Body muted>
                Цена каждого оплаченного пакета распределена поровну между его
                занятиями. Здесь — стоимость ещё не проведённых, с округлением
                до копеек.
              </Body>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Осталось провести</Text>
              <Text style={styles.metricValue}>{totals.remainingLessons}</Text>
              <Body muted>
                Занятий из оплаченных пакетов. Уже проведено:{' '}
                {totals.completedLessons}.
              </Body>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Ожидает оплаты</Text>
              <Text style={styles.metricValue}>
                {money(totals.pendingPaymentsKopecks)}
              </Text>
              <Body muted>
                Пакетов без подтверждения оплаты: {totals.pendingPackageCount}.
              </Body>
            </View>
          </View>
          <Row>
            <Body muted>
              Клиентов: {totals.clientCount} · Данные на{' '}
              {dateTime(dashboard.data.asOf)}
            </Body>
            <Button
              title="Обновить обзор"
              variant="link"
              disabled={dashboard.isFetching}
              onPress={() => void dashboard.refetch()}
            />
          </Row>
          <Card>
            <SectionTitle>Заканчиваются занятия</SectionTitle>
            <Body muted>
              У этих клиентов осталось не больше двух оплаченных занятий по всем
              пакетам. Предложите продолжить обучение.
            </Body>
            {dashboard.data.renewals.length === 0 ? (
              <Empty
                title="Никто не выпал из внимания"
                detail="Здесь появятся клиенты, когда их общий запас оплаченных занятий будет подходить к концу."
              />
            ) : (
              dashboard.data.renewals.map((item) => (
                <View key={item.clientId} style={styles.item}>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemTitle}>{item.clientName}</Text>
                    <Body muted>
                      {item.packageTitle} · {item.totalLessons} занятий ·{' '}
                      {money(item.priceKopecks)}
                    </Body>
                    <Badge
                      title={`Осталось занятий: ${item.remainingLessons}`}
                    />
                  </View>
                  <Button
                    title="Новый пакет"
                    variant="secondary"
                    accessibilityLabel={`Новый пакет для ${item.clientName}`}
                    onPress={() =>
                      router.push({
                        pathname: '/clients/[id]',
                        params: {
                          id: item.clientId,
                          renewPackage: item.packageId,
                        },
                      })
                    }
                  />
                </View>
              ))
            )}
            {dashboard.data.renewals.length > 0 && (
              <Body muted>
                Условия можно изменить перед созданием. Оплату нового пакета вы
                подтвердите отдельно после получения денег.
              </Body>
            )}
          </Card>
          <Card>
            <SectionTitle>Ближайшие 7 дней</SectionTitle>
            <Body muted>
              Первые 10 запланированных занятий. Время — в часовом поясе вашего
              устройства.
            </Body>
            {dashboard.data.upcomingLessons.length === 0 ? (
              <Empty
                title="Есть место для новых планов"
                detail="На ближайшие семь дней занятий пока нет. Откройте пакет клиента, чтобы добавить занятие."
              />
            ) : (
              dashboard.data.upcomingLessons.map((lesson) => (
                <View key={lesson.id} style={styles.item}>
                  <View style={styles.itemInfo}>
                    <Text style={styles.date}>
                      {dateTime(lesson.scheduledAt)}
                    </Text>
                    <Text style={styles.itemTitle}>{lesson.clientName}</Text>
                    <Body muted>{lesson.packageTitle}</Body>
                  </View>
                  <Button
                    title="Открыть пакет →"
                    variant="link"
                    accessibilityLabel={`Открыть занятие ${lesson.clientName}`}
                    onPress={() => router.push(`/packages/${lesson.packageId}`)}
                  />
                </View>
              ))
            )}
          </Card>
        </>
      ) : null}
      {dialog}
    </Page>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
    metric: {
      flex: 1,
      flexBasis: '45%',
      minWidth: 240,
      padding: 24,
      gap: 12,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.surface,
      borderRadius: 18,
    },
    highlight: { backgroundColor: colors.pale, borderColor: colors.blue },
    metricLabel: {
      color: colors.muted,
      fontSize: 14,
      fontWeight: '600',
      lineHeight: 21,
    },
    metricValue: {
      color: colors.ink,
      fontSize: 34,
      lineHeight: 42,
      fontWeight: '700',
      letterSpacing: -1,
    },
    item: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 14,
      paddingTop: 18,
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    itemInfo: { flex: 1, minWidth: 190, gap: 7 },
    itemTitle: {
      color: colors.ink,
      fontSize: 17,
      fontWeight: '600',
      lineHeight: 25,
    },
    date: {
      color: colors.blue,
      fontSize: 15,
      fontWeight: '600',
      lineHeight: 23,
    },
  });
