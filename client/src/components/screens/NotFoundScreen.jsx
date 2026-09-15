export default function NotFoundScreen({ onGoIngest, onGoAsk }) {
  return (
    <div className="notfound-wrap">
      <div className="notfound-inner">
        <div className="notfound-code">404</div>
        <h4>That document isn't here</h4>
        <p>
          The record <code>doc_8842/fields/po_reference</code> was deleted on 2 September when its source file
          was deleted, along with everything we had read from it.
        </p>
        <div className="notfound-actions">
          <button type="button" className="btn btn-primary" title="Go back to your documents" onClick={onGoIngest}>Back to my documents</button>
          <button type="button" className="btn btn-ghost" title="Ask a question about your documents" onClick={onGoAsk}>Ask a question</button>
        </div>
      </div>
    </div>
  );
}
