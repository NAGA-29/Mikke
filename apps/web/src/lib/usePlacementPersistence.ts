import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

type Position = { x: number; y: number };
// Serialize batches so an older PATCH cannot overwrite a newer drag.
export function usePlacementPersistence(diagramId: string) {
  const pending = useRef(new Map<string, Position>());
  const latest = useRef(new Map<string, Position>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const [status, setStatus] = useState('保存済み');
  const [error, setError] = useState<unknown>(null);
  function flush(): Promise<void> {
    clearTimeout(timer.current);
    const task = chain.current.then(async () => {
      const batch = new Map(pending.current);
      pending.current.clear();
      if (!batch.size) return;
      if (mounted.current) setStatus('位置を保存中…');
      let failure: unknown;
      for (const [nodeId, position] of batch) {
        try {
          await api(`/diagrams/${diagramId}/nodes/${nodeId}`, { method: 'PATCH', json: { position_x: position.x, position_y: position.y } });
        } catch (e) {
          if (latest.current.get(nodeId) === position) pending.current.set(nodeId, position);
          failure = e;
        }
      }
      if (mounted.current) {
        setError(failure ?? null);
        setStatus(failure ? '位置の保存に失敗（再試行が必要）' : pending.current.size ? '位置の保存待ち' : '保存済み');
      }
      if (failure) throw failure;
    });
    chain.current = task.catch(() => {});
    return task;
  }
  function queue(nodeId: string, position: Position) {
    latest.current.set(nodeId, position);
    pending.current.set(nodeId, position);
    setStatus('位置の保存待ち');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush().catch(() => {}); }, 500);
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Flush already authorized drags when navigating away; do not discard them.
      void flush().catch(() => {});
    };
    // The Canvas is keyed by diagram ID and this queue belongs to that instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagramId]);
  return { queue, flush, status, error };
}
