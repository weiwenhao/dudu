import { CollectorWidget } from '../collector/CollectorWidget.jsx';
import { useServices } from '../services.jsx';

/** The Collector widget on the dashboard: what the connectors collected, read through the plugin like the Issues widget does. */
export function CollectorCard({ openIssue }) {
  const { request } = useServices();
  return <CollectorWidget request={request} openIssue={openIssue} />;
}
