import { jsx as _jsx } from "react/jsx-runtime";
import { ArticleMappingPanel } from '../directories/ArticleMappingPanel';
export function RelabelingPanel({ session }) {
    return _jsx(ArticleMappingPanel, { enabledClientsOnly: true, session: session, standalone: true });
}
