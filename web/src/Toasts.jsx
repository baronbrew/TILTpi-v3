// Legacy ui_toast: top-right notifications, plus the "Restart Now / Restart Later" dialog.
import { useEffect } from 'react';

const lines = (s) =>
  String(s ?? '')
    .split(/<br\s*\/?>/i)
    .flatMap((part, i) => (i ? [<br key={i} />, part] : [part]));

function Toast({ t, dismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => dismiss(t.id), (t.displayTime || 3) * 1000);
    return () => clearTimeout(timer);
  }, [t, dismiss]);
  return (
    <div className="toast" role="status" onClick={() => dismiss(t.id)}>
      {t.topic && <div className="toast-topic">{t.topic}</div>}
      <div className="toast-msg">{lines(t.message)}</div>
    </div>
  );
}

function Dialog({ t, dismiss, send }) {
  const close = (confirm) => {
    dismiss(t.id);
    if (confirm && t.dialog.command) send(t.dialog.command);
  };
  return (
    <div className="dialog-scrim">
      <div className="dialog" role="dialog" aria-modal="true">
        {t.topic && <h2>{t.topic}</h2>}
        <p>{lines(t.message)}</p>
        <div className="dialog-actions">
          {t.dialog.cancel && <button type="button" onClick={() => close(false)}>{t.dialog.cancel}</button>}
          <button type="button" onClick={() => close(true)}>{t.dialog.ok || 'OK'}</button>
        </div>
      </div>
    </div>
  );
}

export default function Toasts({ toasts, dismiss, send }) {
  const dialog = toasts.find((t) => t.dialog);
  return (
    <>
      <div className="toasts">
        {toasts.filter((t) => !t.dialog).map((t) => (
          <Toast key={t.id} t={t} dismiss={dismiss} />
        ))}
      </div>
      {dialog && <Dialog t={dialog} dismiss={dismiss} send={send} />}
    </>
  );
}
