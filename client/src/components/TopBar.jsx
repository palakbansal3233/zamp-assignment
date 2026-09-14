export function TopProgress({ pct }) {
  return (
    <div className="topbar-track">
      <div className="topbar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Banner({ banner }) {
  if (!banner) return null;
  return (
    <div className="banner">
      <i className={banner.icon} />
      <span className="banner-text">
        <b style={{ fontWeight: 500 }}>{banner.title}</b> {banner.text}
      </span>
      <button type="button" className="btn btn-secondary" title={banner.cta} onClick={banner.action}>{banner.cta}</button>
    </div>
  );
}
