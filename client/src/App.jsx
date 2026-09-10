import { useSiftDemo } from './store/useSiftDemo';
import Rail from './components/Rail';
import { TopProgress, Banner } from './components/TopBar';
import IngestScreen from './components/screens/IngestScreen';
import ReviewScreen from './components/screens/ReviewScreen';
import AskScreen from './components/screens/AskScreen';
import NotFoundScreen from './components/screens/NotFoundScreen';
import StatesPanel from './components/StatesPanel';
import ChatWidget from './components/ChatWidget';
import SessionDialog from './components/SessionDialog';

// Phase A (current): the whole app runs on the demo engine (useSiftDemo),
// ported from the Claude Design export — this is the UI/UX being validated
// before any of it is wired to the real API. Phase B swaps useSiftDemo for
// an equivalent hook backed by client/src/api/client.js; the component tree
// below should not need to change shape when that happens, only what feeds
// it. See decisions.md.
export default function App() {
  const sift = useSiftDemo();
  const { nav, topBar, banner, ingest, review, ask, states, chat, session } = sift;

  return (
    <div className="sift-app">
      <Rail current={nav.current} onGo={nav.go} statesOpen={states.open} onToggleStates={states.toggle} />

      <main className="sift-main">
        <TopProgress pct={topBar.pct} />
        <Banner banner={banner} />

        {nav.current === 'ingest' && <IngestScreen ingest={ingest} />}
        {nav.current === 'review' && <ReviewScreen review={review} />}
        {nav.current === 'ask' && <AskScreen ask={ask} />}
        {nav.current === 'notfound' && <NotFoundScreen onGoIngest={() => nav.go('ingest')} onGoAsk={() => nav.go('ask')} />}
      </main>

      <StatesPanel states={states} />
      <ChatWidget chat={chat} />
      <SessionDialog session={session} />
    </div>
  );
}
