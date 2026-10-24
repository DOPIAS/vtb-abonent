import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../../src/core/auth';
import { request } from '../../../src/core/api';
import { Client, ClientDetail, Package } from '../../../src/core/types';
import { money } from '../../../src/core/format';
import {
  Back,
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
} from '../../../src/components/ui';
import { ClientForm } from '../../../src/components/ClientForm';
import { ThemeColors, useAppTheme } from '../../../src/core/theme';
import { PackageForm } from '../../../src/components/PackageForm';
export default function ClientScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { id, renewPackage } = useLocalSearchParams<{
    id: string;
    renewPackage?: string;
  }>();
  const { token } = useSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [dismissedRenewal, setDismissedRenewal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ['client', id],
    queryFn: ({ signal }) =>
      request<ClientDetail>(`/clients/${id}`, { token, signal }),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['client', id] }),
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
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
  const { client, packages } = detail.data;
  const renewal =
    !adding && renewPackage !== dismissedRenewal
      ? packages.find(
          (pack) => pack.id === renewPackage && pack.paymentStatus === 'paid',
        )
      : undefined;
  const closePackageForm = () => {
    setAdding(false);
    setDismissedRenewal(renewPackage ?? null);
  };
  return (
    <Page navigation="clients">
      <Back href="/clients" title="Клиенты" />
      <Heading
        eyebrow="Карточка клиента"
        title={client.name}
        subtitle={
          [client.phone, client.contact].filter(Boolean).join(' · ') ||
          'Контакт не указан'
        }
        action={
          <Button
            title="Редактировать"
            variant="secondary"
            onPress={() => setEditing(true)}
          />
        }
      />
      {notice && <Notice message={notice} success />}
      {editing && (
        <Card>
          <SectionTitle>Редактировать клиента</SectionTitle>
          <ClientForm
            initial={{
              name: client.name,
              contact: client.contact || '',
              phone: client.phone || '',
            }}
            onCancel={() => setEditing(false)}
            onSave={async (values) => {
              await request<Client>(`/clients/${id}`, {
                token,
                method: 'PATCH',
                body: values,
              });
              await refresh();
              setEditing(false);
              setNotice('Данные клиента сохранены.');
            }}
          />
        </Card>
      )}
      <Heading
        title="Пакеты занятий"
        action={
          <Button
            title="+ Создать пакет"
            onPress={() => {
              setDismissedRenewal(renewPackage ?? null);
              setAdding(true);
            }}
          />
        }
      />
      {(adding || renewal) && (
        <Card>
          <SectionTitle>Новый пакет</SectionTitle>
          {renewal && (
            <Body muted>
              Взяли название, размер и стоимость последнего оплаченного пакета.
              Проверьте условия перед созданием.
            </Body>
          )}
          <PackageForm
            key={renewal?.id ?? 'new'}
            initial={renewal}
            onCancel={closePackageForm}
            onSave={async (values) => {
              const created = await request<Package>(
                `/clients/${id}/packages`,
                { token, method: 'POST', body: values },
              );
              await refresh();
              closePackageForm();
              router.push(`/packages/${created.id}`);
            }}
          />
        </Card>
      )}
      {packages.length === 0 ? (
        <Card>
          <Empty
            title="Первый пакет — новый старт"
            detail="Укажите количество занятий и общую стоимость. Оплату вы сможете подтвердить отдельно."
          />
        </Card>
      ) : (
        packages.map((item) => (
          <Card key={item.id}>
            <Row>
              <View style={styles.info}>
                <SectionTitle>{item.title}</SectionTitle>
                <Body muted>
                  {item.totalLessons} занятий · {money(item.priceKopecks)}
                </Body>
              </View>
              <Badge
                title={
                  item.paymentStatus === 'paid' ? 'Оплачен' : 'Ожидает оплаты'
                }
                paid={item.paymentStatus === 'paid'}
              />
            </Row>
            <Row>
              <View style={styles.info}>
                <Text style={styles.remaining}>
                  {item.remainingLessons}
                  <Text style={styles.remainingLabel}> осталось</Text>
                </Text>
                <Body muted>
                  Оплачено {item.paidLessons} · Проведено{' '}
                  {item.completedLessons}
                </Body>
              </View>
              <Button
                title="Открыть пакет →"
                variant="secondary"
                accessibilityLabel={`Открыть пакет ${item.title}`}
                onPress={() => router.push(`/packages/${item.id}`)}
              />
            </Row>
          </Card>
        ))
      )}
    </Page>
  );
}
const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    info: { flex: 1, minWidth: 190, gap: 5 },
    remaining: {
      fontSize: 42,
      fontWeight: '600',
      color: colors.blue,
      letterSpacing: -1.5,
    },
    remainingLabel: {
      fontSize: 15,
      fontWeight: '400',
      color: colors.muted,
      letterSpacing: 0,
    },
  });
