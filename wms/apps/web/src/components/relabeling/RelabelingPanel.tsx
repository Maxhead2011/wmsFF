import type { AuthSession } from '../../lib/api';
import { ArticleMappingPanel } from '../directories/ArticleMappingPanel';

export function RelabelingPanel({ session }: { session: AuthSession }) {
  return <ArticleMappingPanel enabledClientsOnly session={session} standalone />;
}
