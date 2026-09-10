const NAV = [
  ['ingest', 'ph ph-tray', 'Ingest'],
  ['review', 'ph ph-columns', 'Review'],
  ['ask', 'ph ph-chat-teardrop-text', 'Ask']
];

export default function Rail({ current, onGo, statesOpen, onToggleStates }) {
  return (
    <nav className="rail">
      <div className="rail-logo">S</div>
      {NAV.map(([key, icon, label]) => (
        <button
          key={key}
          type="button"
          className={`rail-btn${current === key ? ' is-active' : ''}`}
          title={label}
          onClick={() => onGo(key)}
        >
          <i className={icon} />
        </button>
      ))}
      <div className="rail-spacer" />
      <button
        type="button"
        className={`rail-states-btn${statesOpen ? ' is-active' : ''}`}
        title="States"
        onClick={onToggleStates}
      >
        <i className="ph ph-flask" />
      </button>
    </nav>
  );
}
