// Shell: toolbar, side menu, tab routing (#/0..#/3 like the legacy dashboard), toasts.
import { useEffect, useState } from 'react';
import { useTiltPi } from './connection.js';
import { Icon } from './icons.jsx';
import Toasts from './Toasts.jsx';
import TiltTab from './tabs/TiltTab.jsx';
import LoggingTab from './tabs/LoggingTab.jsx';
import CalibrationTab from './tabs/CalibrationTab.jsx';
import SystemTab from './tabs/SystemTab.jsx';

const TABS = [
  { name: 'Tilt Pi', icon: 'tachometer', Component: TiltTab },
  { name: 'Logging', icon: 'lineChart', Component: LoggingTab },
  { name: 'Calibration', icon: 'bullseye', Component: CalibrationTab },
  { name: 'System', icon: 'clock', Component: SystemTab },
];

const tabFromHash = () => {
  const n = Number(location.hash.replace(/^#!?\/?/, ''));
  return Number.isInteger(n) && n >= 0 && n < TABS.length ? n : 0;
};

/** Selected Tilt is per browser (legacy shared it across all viewers). */
function useSelectedColor(options) {
  const [chosen, setChosen] = useState(() => localStorage.getItem('tiltpi.color') || '');
  const color = options.includes(chosen) ? chosen : (options[0] ?? '');
  const setColor = (c) => {
    localStorage.setItem('tiltpi.color', c);
    setChosen(c);
  };
  return [color, setColor];
}

export default function App() {
  const { state, statics, toasts, connected, send, dismissToast } = useTiltPi();
  const [tab, setTab] = useState(tabFromHash);
  const [menuOpen, setMenuOpen] = useState(false);
  const [color, setColor] = useSelectedColor(state?.options ?? []);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (i) => {
    location.hash = '#/' + i;
    setTab(i);
    setMenuOpen(false);
  };
  const { Component } = TABS[tab];

  return (
    <div className="app">
      <header className="toolbar">
        <button type="button" className="menu-btn" aria-label="Toggle menu" onClick={() => setMenuOpen((o) => !o)}>
          <Icon name="menu" size={24} />
        </button>
        {/* Main page: the Tilt Pi logo (its grey matches the toolbar); other pages keep their title. */}
        <h1>
          {tab === 0 ? (
            <img className="toolbar-logo" src={`${import.meta.env.BASE_URL}tiltpi-logo.svg`} alt="Tilt Pi" />
          ) : (
            TABS[tab].name
          )}
        </h1>
        {!connected && <span className="offline">reconnecting…</span>}
      </header>

      <nav className={'sidenav' + (menuOpen ? ' open' : '')}>
        {TABS.map((t, i) => (
          <button type="button" key={t.name} className={i === tab ? 'active' : ''} onClick={() => go(i)}>
            <Icon name={t.icon} size={18} />
            <span>{t.name}</span>
          </button>
        ))}
        <a href="http://tilthydrometer.com" target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}>
          <Icon name="openInBrowser" size={20} />
          <span>Tilt Shop</span>
        </a>
      </nav>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}

      <main className="content">
        {state ? <Component state={state} statics={statics} send={send} color={color} setColor={setColor} /> : null}
      </main>

      <Toasts toasts={toasts} dismiss={dismissToast} send={send} />
    </div>
  );
}
