export default function ChatWidget({ chat }) {
  if (!chat.open) {
    return (
      <button type="button" className="chat-launcher" title="Open the Ask Sift chat" onClick={chat.toggle}>
        <i className="ph ph-chat-teardrop-dots" />Ask Sift
        {chat.badge && <span className="chat-launcher-badge" />}
      </button>
    );
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span
          className="chat-dot"
          style={{ background: chat.broken ? 'var(--color-neutral-600)' : 'var(--color-accent)' }}
          title={chat.broken ? 'Not currently available' : 'Ready'}
        />
        <div className="chat-header-text">
          <div className="chat-title">Ask Sift</div>
          <div className="chat-status">{chat.status}</div>
        </div>
        <button type="button" className="chat-minimize" title="Minimize this chat" onClick={chat.toggle}>
          <i className="ph ph-minus" />
        </button>
      </div>

      {chat.busy && (
        <div className="chat-progress-track">
          <div className="chat-progress-fill" />
        </div>
      )}

      <div className="chat-messages">
        {chat.msgs.map((m) => (
          <div key={m.key} className={`chat-msg-wrap${m.role === 'user' ? ' is-user' : ''}`}>
            <div className={`chat-bubble${m.role === 'user' ? ' is-user' : ''}${m.role === 'err' ? ' is-err' : ''}`}>
              {m.title && <div className="chat-bubble-title">{m.title}</div>}
              <div className="chat-bubble-text">{m.text}</div>
              {m.cites.length > 0 && (
                <div className="chat-cites">
                  {m.cites.map((c, i) => (
                    <button key={i} type="button" className="chat-cite-chip" title={`Open this field in Review: ${c.label}`} onClick={c.go}>{c.label}</button>
                  ))}
                </div>
              )}
              {m.actions.length > 0 && (
                <div className="chat-bubble-actions">
                  {m.actions.map((a, i) => (
                    <button key={i} type="button" className={`btn ${a.cls}`} title={a.label} onClick={a.run}>{a.label}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {chat.busy && (
          <div className="chat-typing"><span /><span /><span /></div>
        )}
      </div>

      {!chat.busy && (
        <div className="chat-chips">
          {chat.chips.map((c, i) => (
            <button key={i} type="button" className="chat-chip" title={`Ask: "${c.label}"`} onClick={c.run}>{c.label}</button>
          ))}
        </div>
      )}

      <div className="chat-input-row">
        <input
          value={chat.draft}
          onChange={(e) => chat.onDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && chat.draft.trim()) chat.send(); }}
          placeholder={chat.placeholder}
          title="Type a question about any of your uploaded documents"
        />
        <button type="button" className="chat-send-btn" title="Send" onClick={chat.send}>
          <i className="ph ph-paper-plane-right" />
        </button>
      </div>
    </div>
  );
}
