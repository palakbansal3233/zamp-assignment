import { useCallback, useRef, useState } from 'react';

// A silently-failed action (a field confirm that didn't save, a delete that
// bounced) is worse than a loud one — the user has no idea their click
// didn't do anything. This gives every one of those a visible, self-
// dismissing notice instead of a swallowed catch block.
let nextId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message, type = 'info', durationMs = 5000) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message, type }]);
      const timer = setTimeout(() => dismiss(id), durationMs);
      timers.current.set(id, timer);
      return id;
    },
    [dismiss]
  );

  return { toasts, push, dismiss };
}
