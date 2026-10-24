import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Lesson, PublicPackage } from '../core/types';
import { dateTime, money } from '../core/format';
import { Badge, Body, Card, Empty, Row, SectionTitle } from './ui';
import { ThemeColors, useAppTheme } from '../core/theme';

function useStyles() {
  const { colors } = useAppTheme();
  return useMemo(() => createStyles(colors), [colors]);
}

export function SubscriptionSummary({ data }: { data: PublicPackage }) {
  const styles = useStyles();
  const paid = data.paymentStatus === 'paid';
  return (
    <View style={styles.hero}>
      <View style={styles.heroTop}>
        <View style={styles.grow}>
          <Text style={styles.eyebrow}>АБОНЕМЕНТ</Text>
          <Text style={styles.title}>{data.title}</Text>
        </View>
        <Badge
          title={paid ? 'Оплата подтверждена' : 'Ожидает оплаты'}
          paid={paid}
        />
      </View>
      <View style={styles.metrics}>
        <View style={styles.remaining}>
          <Text style={styles.number}>{data.remainingLessons}</Text>
          <Text style={styles.remainingLabel}>занятий осталось</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.counts}>
          <Text style={styles.metricLabel}>
            Оплачено<Text style={styles.metricValue}> {data.paidLessons}</Text>
          </Text>
          <Text style={styles.metricLabel}>
            Проведено
            <Text style={styles.metricValue}> {data.completedLessons}</Text>
          </Text>
          <Text style={styles.price}>
            {data.totalLessons} занятий · {money(data.priceKopecks)}
          </Text>
        </View>
      </View>
      {!paid && (
        <Text style={styles.explanation}>
          После подтверждения оплаты преподавателем занятия станут доступны для
          списания.
        </Text>
      )}
    </View>
  );
}
export const lessonLabels: Record<Lesson['status'], string> = {
  scheduled: 'Запланировано',
  completed: 'Проведено',
  cancelled: 'Отменено',
};
export function LessonHistory({
  lessons,
  renderActions,
}: {
  lessons: Lesson[];
  renderActions?: (lesson: Lesson) => React.ReactNode;
}) {
  const styles = useStyles();
  const sorted = [...lessons].sort(
    (a, b) =>
      new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime(),
  );
  return (
    <Card>
      <SectionTitle>Занятия</SectionTitle>
      {sorted.length === 0 ? (
        <Empty
          title="Занятий пока нет"
          detail="Здесь появятся запланированные занятия и история проведённых уроков."
        />
      ) : (
        sorted.map((lesson) => (
          <View key={lesson.id} style={styles.lesson}>
            <Row>
              <View style={styles.grow}>
                <Text style={styles.lessonDate}>
                  {dateTime(lesson.scheduledAt)}
                </Text>
                <Text style={styles.lessonStatus}>
                  {lessonLabels[lesson.status]}
                </Text>
              </View>
              <View
                style={[
                  styles.statusDot,
                  lesson.status === 'completed' && styles.completedDot,
                  lesson.status === 'cancelled' && styles.cancelledDot,
                ]}
              />
            </Row>
            {renderActions?.(lesson)}
          </View>
        ))
      )}
      <Body muted>Время указано в часовом поясе вашего устройства.</Body>
    </Card>
  );
}
const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    hero: {
      backgroundColor: colors.hero,
      borderRadius: 20,
      padding: 28,
      gap: 24,
    },
    heroTop: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'flex-start',
      gap: 18,
    },
    grow: { flex: 1, minWidth: 170 },
    eyebrow: {
      color: colors.heroMuted,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 2,
      marginBottom: 10,
    },
    title: {
      color: colors.heroText,
      fontSize: 27,
      lineHeight: 34,
      fontWeight: '600',
      letterSpacing: -0.6,
    },
    metrics: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 28,
    },
    remaining: { minWidth: 150 },
    number: {
      color: colors.heroText,
      fontSize: 84,
      lineHeight: 94,
      letterSpacing: -4,
      fontWeight: '600',
    },
    remainingLabel: { color: colors.heroMuted, fontSize: 14 },
    divider: { height: 72, width: 1, backgroundColor: '#FFFFFF38' },
    counts: { gap: 12 },
    metricLabel: { color: colors.heroMuted, fontSize: 15 },
    metricValue: { fontWeight: '700', color: colors.heroText, fontSize: 20 },
    price: { color: colors.heroMuted, fontSize: 12, paddingTop: 2 },
    explanation: { color: colors.heroMuted, fontSize: 13, lineHeight: 21 },
    lesson: {
      gap: 12,
      paddingVertical: 18,
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    lessonDate: {
      color: colors.ink,
      fontSize: 16,
      fontWeight: '600',
      lineHeight: 25,
    },
    lessonStatus: { color: colors.muted, fontSize: 13, marginTop: 4 },
    statusDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.blue,
    },
    completedDot: { backgroundColor: colors.green },
    cancelledDot: { backgroundColor: colors.placeholder },
  });
