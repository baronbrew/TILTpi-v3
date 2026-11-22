// Widget kit that reproduces the legacy node-red-dashboard look (6-unit wide groups,
// 53 px rows, dark theme). Keep visual details in styles.css.
import { Children, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { fixed } from './format.js';

export const GROUP_WIDTH = 320; // 6 × 48 px units + gaps + border
const GAP = 4;
const COLUMN = GROUP_WIDTH + GAP;

/** Places groups left→right into the currently shortest column (dashboard "masonry" layout). */
export function Masonry({ children }) {
  const ref = useRef(null);
  const [layout, setLayout] = useState({ pos: [], width: GROUP_WIDTH, height: 0 });
  const items = Children.toArray(children).filter(Boolean);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const avail = el.parentElement.clientWidth - 12;
      const cols = Math.max(1, Math.floor((avail + GAP) / COLUMN));
      const heights = new Array(cols).fill(0);
      const pos = [...el.children].map((child) => {
        const c = heights.indexOf(Math.min(...heights));
        const p = { left: c * COLUMN, top: heights[c] };
        heights[c] += child.offsetHeight + GAP;
        return p;
      });
      const next = { pos, width: cols * COLUMN - GAP, height: Math.max(...heights) };
      setLayout((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el.parentElement);
    for (const c of el.children) ro.observe(c);
    return () => ro.disconnect();
  }, [items.length]);

  return (
    <div className="masonry" ref={ref} style={{ width: layout.width, height: layout.height }}>
      {items.map((child, i) => (
        <div key={child.key ?? i} className="masonry-item" style={layout.pos[i] ?? { visibility: 'hidden' }}>
          {child}
        </div>
      ))}
    </div>
  );
}

export function Group({ title, children, className = '' }) {
  return (
    <section className={'group ' + className}>
      {title && <h3 className="group-title">{title}</h3>}
      <div className="group-body">{children}</div>
    </section>
  );
}

export function Button({ label, onClick, icon, danger = false, style }) {
  return (
    <button type="button" className={'w w-button' + (danger ? ' danger' : '')} onClick={onClick} style={style}>
      {icon && <Icon name={icon} size={18} />}
      <span>{label}</span>
    </button>
  );
}

export function Switch({ label, checked, onChange }) {
  return (
    <div className="w w-row w-switch" role="switch" aria-checked={!!checked} tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && onChange(!checked)}>
      <span className="w-label">{label}</span>
      <span className={'switch' + (checked ? ' on' : '')}>
        <span className="switch-bar" />
        <span className="switch-thumb" />
      </span>
    </div>
  );
}

/** Text box that sends on Enter or when it loses focus (legacy ui_text_input with delay 0). */
/**
 * Text box that commits on Enter or when leaving it. `fillOnFocus`: text put in the box when it's
 * focused (e.g. the default email); that text is only committed by Enter, not by just leaving.
 */
export function TextInput({ label, value, onCommit, clearAfterMs, autoFocus = false, fillOnFocus }) {
  const [draft, setDraft] = useState(null); // null = not editing, show server value
  const enter = useRef(false);
  const shown = draft ?? (value ?? '');
  const commit = () => {
    const viaEnter = enter.current;
    enter.current = false;
    if (draft === null) return;
    const v = draft;
    setDraft(null);
    if (v === (value ?? '')) return;
    if (fillOnFocus && v === fillOnFocus && !viaEnter) return; // autofill untouched: needs Enter
    onCommit(v);
  };
  return (
    <div className={'w w-input' + (String(shown) !== '' ? ' has-value' : '')}>
      <label>
        <span className="w-input-label">{label}</span>
        <input
          value={shown}
          autoFocus={autoFocus}
          onFocus={(e) => {
            const fill = fillOnFocus && !value ? fillOnFocus : String(value ?? '');
            setDraft(fill);
            if (fill && fillOnFocus) {
              const el = e.target;
              setTimeout(() => el.select()); // easy to type over
            }
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            // Leaving the box commits (onBlur). Committing here too sent every value twice.
            if (e.key === 'Enter') {
              enter.current = true;
              e.currentTarget.blur();
            }
          }}
        />
      </label>
    </div>
  );
}

export function Dropdown({ label, placeholder, options, value, onChange }) {
  const has = options.some((o) => String(o.value) === String(value));
  return (
    <div className="w w-row w-dropdown">
      {label && <span className="w-label">{label}</span>}
      <div className="select-wrap">
        <select value={has ? String(value) : ''} onChange={(e) => onChange(options.find((o) => String(o.value) === e.target.value)?.value)}>
          {!has && <option value="" disabled>{placeholder}</option>}
          {options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
          ))}
        </select>
        <Icon name="dropDown" size={20} className="select-caret" />
      </div>
    </div>
  );
}

/** Range slider; `onCommit` fires on release, `onInput` while dragging. */
export function Slider({ label, min, max, step, value, onInput, onCommit }) {
  const [drag, setDrag] = useState(null);
  const shown = drag ?? value ?? min;
  const end = () => {
    if (drag !== null) onCommit?.(drag);
    setDrag(null);
  };
  const pct = ((Number(shown) - min) / (max - min)) * 100;
  return (
    <div className="w w-row w-slider">
      <span className="w-label">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={shown}
        style={{ '--pct': pct + '%' }}
        onChange={(e) => {
          const v = Number(e.target.value);
          setDrag(v);
          onInput?.(v);
        }}
        onPointerUp={end} onKeyUp={end} onBlur={end}
      />
    </div>
  );
}

/** Up/down numeric (legacy ui_numeric). */
/**
 * Legacy ui_numeric: up/down buttons, and the value can be typed (Enter or leaving the box
 * applies it, Esc cancels; clamped to min/max; arrow keys step while focused).
 */
export function Numeric({ label, value, min, max, step, onChange, digits }) {
  const [draft, setDraft] = useState(null); // text being typed; null = not editing
  const clamp = (v) => Math.min(max, Math.max(min, v));
  const decimals = digits ?? (String(step).split('.')[1]?.length ?? 0);
  const round = (v) => Number(clamp(v).toFixed(decimals)) || 0; // || 0: no -0
  const bump = (dir) => onChange(round(Number(value ?? min) + dir * step));
  const empty = value === undefined || value === null || value === '';
  const shown = empty ? '' : fixed(value, decimals);
  const commit = () => {
    if (draft === null) return;
    const v = Number(String(draft).trim().replace(',', '.')); // accept "1,050" decimal commas
    setDraft(null);
    if (String(draft).trim() !== '' && Number.isFinite(v) && round(v) !== Number(value)) onChange(round(v));
  };
  return (
    <div className="w w-row w-numeric">
      <span className="w-label">{label}</span>
      <span className="numeric-ctl">
        <button type="button" aria-label="decrease" onClick={() => bump(-1)}><Icon name="expandMore" /></button>
        <input
          className="numeric-value"
          type="text"
          inputMode="decimal"
          aria-label={label}
          value={draft ?? shown}
          onFocus={(e) => {
            setDraft(shown);
            e.target.select();
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') {
              setDraft(null);
              setTimeout(() => e.target.blur());
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const base = Number(String(draft ?? shown).replace(',', '.'));
              const v = round((Number.isFinite(base) ? base : Number(value ?? min)) + (e.key === 'ArrowUp' ? step : -step));
              setDraft(fixed(v, decimals));
              onChange(v);
            }
          }}
        />
        <button type="button" aria-label="increase" onClick={() => bump(1)}><Icon name="expandLess" /></button>
      </span>
    </div>
  );
}

/** Read-only text (legacy ui_text layouts: row-left, row-spread, col-center). */
export function Text({ label, value, layout = 'row-left', html = false }) {
  const v = html ? <span className="w-value" dangerouslySetInnerHTML={{ __html: value ?? '' }} /> : <span className="w-value">{value}</span>;
  return (
    <div className={'w w-text ' + layout}>
      {label && <span className="w-label">{label}</span>}
      {v}
    </div>
  );
}

export function useInterval(fn, ms) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    const t = setInterval(() => saved.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}
