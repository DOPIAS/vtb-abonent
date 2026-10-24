import { Redirect } from 'expo-router';
import { useSession } from '../src/core/auth';
import { Failure, Loading, Page } from '../src/components/ui';
export default function Index() {
  const session = useSession();
  if (session.loading)
    return (
      <Page>
        <Loading />
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
  return <Redirect href={session.token ? '/dashboard' : '/login'} />;
}
