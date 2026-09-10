export default function NotFoundScreen({ onGoIngest, onGoAsk }) {
  return (
    <div className="notfound-wrap">
      <div className="notfound-inner">
        <div className="notfound-code">404</div>
        <h4>That document isn't here</h4>
        <p>
          The record <code>doc_8842/fields/po_reference</code> was deleted on 2 September when its source file
          was removed from the corpus. Its extracted fields went with it.
        </p>
        <div className="notfound-actions">
          <button type="button" className="btn btn-primary" onClick={onGoIngest}>Back to queue</button>
          <button type="button" className="btn btn-ghost" onClick={onGoAsk}>Search the corpus</button>
        </div>
      </div>
    </div>
  );
}
