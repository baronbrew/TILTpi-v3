// WebSocket connection to the Tilt Pi server: receives state/toasts, sends commands.
import { useEffect, useRef, useState, useCallback } from 'react';

export function useTiltPi() {
  const [state, setState] = useState(null);
  const [statics, setStatics] = useState({ timezones: [], timezone: '' });
  const [toasts, setToasts] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const toastId = useRef(0);

  useEffect(() => {
    let closed = false;
    let retry = 500;
    let timer;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 500;
        setConnected(true);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'state') setState(msg.state);
        else if (msg.type === 'static') setStatics({ timezones: msg.timezones, timezone: msg.timezone });
        else if (msg.type === 'toast') {
          const id = ++toastId.current;
          setToasts((t) => [...t, { id, ...msg.toast }]);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        timer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 5000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((name, args = {}) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'cmd', name, args }));
  }, []);

  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  return { state, statics, toasts, connected, send, dismissToast };
}
