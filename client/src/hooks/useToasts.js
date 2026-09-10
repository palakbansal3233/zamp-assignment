import { useCallback, useRef, useState } from 'react';

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
    (message, type = 'info', durationMs = 4500) => {
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
