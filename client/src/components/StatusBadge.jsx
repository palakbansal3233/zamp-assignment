const LABELS = {
  processing: 'Processing…',
  done: 'Done',
  error: 'Failed',
};

export default function StatusBadge({ status }) {
  return <span className={`status-badge status-badge--${status}`}>{LABELS[status] || status}</span>;
}
