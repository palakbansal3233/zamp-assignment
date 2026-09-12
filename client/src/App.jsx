import { useSift } from './store/useSift';
import Rail from './components/Rail';
import { TopProgress, Banner } from './components/TopBar';
import IngestScreen from './components/screens/IngestScreen';
import ReviewScreen from './components/screens/ReviewScreen';
import AskScreen from './components/screens/AskScreen';
import NotFoundScreen from './components/screens/NotFoundScreen';
import StatesPanel from './components/StatesPanel';
import ChatWidget from './components/ChatWidget';
import SessionDialog from './components/SessionDialog';

// Phase B: the app runs on useSift, the real-data engine — see
// decisions.md §24. It composes real API state with the original demo
// engine (useSiftDemo) for the States-panel scenarios that still need
// infrastructure this project doesn't build (auth, billing, an offline
// queue); the component tree below is unchanged from Phase A, since both
// engines return the same shape.
export default function App() {
  const sift = useSift();
  const { nav, topBar, banner, ingest, review, ask, states, chat, session, loading } = sift;

  return (
    <div className="sift-app">
      <Rail current={nav.current} onGo={nav.go} statesOpen={states.open} onToggleStates={states.toggle} />

      <main className="sift-main">
        <TopProgress pct={topBar.pct} />
        <Banner banner={banner} />

        {loading ? (
          <p className="text-muted" style={{ padding: 'var(--space-8)' }}>Loading your documents…</p>
        ) : (
          <>
            {nav.current === 'ingest' && <IngestScreen ingest={ingest} />}
            {nav.current === 'review' && <ReviewScreen review={review} />}
            {nav.current === 'ask' && <AskScreen ask={ask} />}
            {nav.current === 'notfound' && <NotFoundScreen onGoIngest={() => nav.go('ingest')} onGoAsk={() => nav.go('ask')} />}
          </>
        )}
      </main>

      <StatesPanel states={states} />
      <ChatWidget chat={chat} />
      <SessionDialog session={session} />
    </div>
  );
}
