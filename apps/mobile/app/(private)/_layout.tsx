import { Redirect, Slot } from 'expo-router';
import { useSession } from '../../src/core/auth';
import { Failure, Loading, Page } from '../../src/components/ui';
export default function PrivateLayout() {
  const session = useSession();
  if (session.loading)
    return (
      <Page>
        <Loading message="Проверяем сессию…" />
      </Page>
    );
  if (session.bootError)
    return (
      <Page>
        <Failure
          error={session.bootError}
          retry={() => void session.reload()}
        />
      </Page>
    );
  if (!session.token) return <Redirect href="/login" />;
  return <Slot />;
}
