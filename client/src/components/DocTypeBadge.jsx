import { docTypeColor } from '../utils/color';
import { humanizeKey } from '../utils/format';

export default function DocTypeBadge({ docType }) {
  if (!docType) return null;
  const color = docTypeColor(docType);
  return (
    <span className="doctype-badge" style={{ '--doctype-color': color }}>
      {humanizeKey(docType)}
    </span>
  );
}
