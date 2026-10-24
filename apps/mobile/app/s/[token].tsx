import { useLocalSearchParams } from 'expo-router';
import { PublicScreen } from '../../src/screens/PublicScreen';
export default function PublicSubscription() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <PublicScreen token={token || ''} />;
}
