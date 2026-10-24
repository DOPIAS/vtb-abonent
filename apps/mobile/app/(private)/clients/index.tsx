import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../../src/core/auth';
import { errorMessage, request } from '../../../src/core/api';
import { Client } from '../../../src/core/types';
import {
  Body,
  Button,
  Card,
  Empty,
  Failure,
  Heading,
  Input,
  Loading,
  Notice,
  Page,
  Row,
  SectionTitle,
} from '../../../src/components/ui';
import { ClientForm } from '../../../src/components/ClientForm';
import { ThemeColors, useAppTheme } from '../../../src/core/theme';
import { useConfirmation } from '../../../src/components/Confirm';
export default function Clients() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { token, user, logout } = useSession();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmation();
  const clients = useQuery({
    queryKey: ['clients', search],
    queryFn: ({ signal }) =>
      request<{ items: Client[] }>(`/clients?q=${encodeURIComponent(search)}`, {
        token,
        signal,
      }),
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
  return (
    <Page navigation="clients">
      <Heading
        eyebrow={`Здравствуйте, ${user?.name || 'преподаватель'}`}
        title="Ваши клиенты"
        subtitle="Каждый абонемент и каждое занятие — под рукой."
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
      <Row>
        <View style={styles.search}>
          <Input
            label="Поиск клиентов"
            value={search}
            onChangeText={setSearch}
            placeholder="Имя, телефон или контакт"
            autoCapitalize="none"
          />
        </View>
        <View style={styles.add}>
          <Button title="+ Добавить клиента" onPress={() => setAdding(true)} />
        </View>
      </Row>
      {adding && (
        <Card>
          <SectionTitle>Новый клиент</SectionTitle>
          <ClientForm
            onCancel={() => setAdding(false)}
            onSave={async (values) => {
              const client = await request<Client>('/clients', {
                method: 'POST',
                body: values,
                token,
              });
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['clients'] }),
                queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
              ]);
              setAdding(false);
              router.push(`/clients/${client.id}`);
            }}
          />
        </Card>
      )}
      {clients.isPending ? (
        <Loading />
      ) : clients.isError ? (
        <Failure error={clients.error} retry={() => void clients.refetch()} />
      ) : (
        <Card>
          <Row>
            <SectionTitle>Клиенты</SectionTitle>
            <Text style={styles.count}>{clients.data.items.length}</Text>
          </Row>
          {clients.data.items.length === 0 ? (
            <Empty
              title={
                search ? 'Ничего не нашлось' : 'Здесь начинается ваша практика'
              }
              detail={
                search
                  ? 'Попробуйте другое имя или контакт.'
                  : 'Добавьте первого клиента, чтобы создать для него пакет занятий.'
              }
            />
          ) : (
            clients.data.items.map((client) => (
              <View key={client.id} style={styles.clientRow}>
                <View style={styles.avatar}>
                  <Text style={styles.initial}>
                    {client.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.clientInfo}>
                  <Text style={styles.clientName}>{client.name}</Text>
                  <Body muted>
                    {[client.phone, client.contact]
                      .filter(Boolean)
                      .join(' · ') || 'Контакт не указан'}
                  </Body>
                </View>
                <Button
                  title="Открыть →"
                  variant="link"
                  accessibilityLabel={`Открыть клиента ${client.name}`}
                  onPress={() => router.push(`/clients/${client.id}`)}
                />
              </View>
            ))
          )}
        </Card>
      )}
      {dialog}
    </Page>
  );
}
const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    search: { flex: 1, minWidth: 230 },
    add: { paddingTop: 24 },
    count: { color: colors.muted, fontSize: 14 },
    clientRow: {
      flexDirection: 'row',
      gap: 14,
      alignItems: 'center',
      flexWrap: 'wrap',
      paddingVertical: 18,
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    avatar: {
      backgroundColor: colors.pale,
      width: 44,
      height: 44,
      borderRadius: 15,
      justifyContent: 'center',
      alignItems: 'center',
    },
    initial: { color: colors.blue, fontSize: 20, fontWeight: '600' },
    clientInfo: { flex: 1, minWidth: 150 },
    clientName: {
      color: colors.ink,
      fontSize: 17,
      fontWeight: '600',
      marginBottom: 4,
    },
  });
