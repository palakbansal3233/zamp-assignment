// Labels are rendered, not just hover titles. Three unlabelled icons ask you
// to already know what the product does; a tooltip only helps someone who
// has both a mouse and a reason to hover. The words are what the person
// actually wants to do, not what the system does to their file.
const NAV = [
  ['ingest', 'ph ph-tray', 'Documents', 'Add and see your documents'],
  ['review', 'ph ph-columns', 'Review', 'Review what was read from a document'],
  ['ask', 'ph ph-chat-teardrop-text', 'Ask', 'Ask a question about your documents'],
];

export default function Rail({ current, onGo, statesOpen, onToggleStates, statesEnabled }) {
  return (
    <nav className="rail">
      <div className="rail-logo">S</div>
      {NAV.map(([key, icon, label, hint]) => (
        <button
          key={key}
          type="button"
          className={`rail-btn${current === key ? ' is-active' : ''}`}
          title={hint}
          aria-current={current === key ? 'page' : undefined}
          onClick={() => onGo(key)}
        >
          <i className={icon} />
          <span className="rail-btn-label">{label}</span>
        </button>
      ))}
      <div className="rail-spacer" />
      {/* The scenario switcher is a build-time tool, not a feature of the
          product — a "Demo" button sitting in the navigation invites someone
          to click it expecting something theirs. It's still reachable at
          ?demo=1 (see README) so the 15 designed states remain inspectable
          without shipping a dev control into the UI. */}
      {statesEnabled && (
        <button
          type="button"
          className={`rail-states-btn${statesOpen ? ' is-active' : ''}`}
          title="Scenario switcher — preview how the app handles errors and edge cases"
          onClick={onToggleStates}
        >
          <i className="ph ph-flask" />
          <span className="rail-btn-label">States</span>
        </button>
      )}
    </nav>
  );
}
