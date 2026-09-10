export default function StatesPanel({ states }) {
  if (!states.open) return null;
  return (
    <div className="states-panel">
      <div className="states-panel-header">
        <h6>States</h6>
        <button type="button" className="states-panel-close" onClick={states.toggle}>
          <i className="ph ph-x" />
        </button>
      </div>
      <div className="states-list">
        {states.scenarios.map((sc) => (
          <button
            key={sc.id}
            type="button"
            className={`state-btn${states.current === sc.id ? ' is-active' : ''}`}
            onClick={sc.run}
          >
            <span className="state-btn-label">{sc.label}</span>
            <span className="state-btn-note">{sc.note}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
