import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, X } from 'lucide-react';

export function Modal({ title, icon, size, onClose, children, footer, bodyStyle, noPadding }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose && onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className={`modal ${size || ''}`} role="dialog" aria-modal="true">
        {title != null && (
          <div className="modal-header">
            {icon}
            <h2>{title}</h2>
            {onClose && (
              <button className="icon-btn sm" onClick={onClose} title="Close">
                <X size={16} />
              </button>
            )}
          </div>
        )}
        <div className="modal-body" style={{ ...(noPadding ? { padding: 0 } : null), ...bodyStyle }}>
          {children}
        </div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Switch({ on, onChange, disabled, title }) {
  return <button type="button" className={`switch ${on ? 'on' : ''}`} onClick={() => !disabled && onChange(!on)} disabled={disabled} title={title} aria-pressed={!!on} />;
}

export function Segmented({ value, options, onChange }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)} title={o.title}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Floating menu. items: { label, icon, shortcut, checked, disabled, onClick, items, separator, heading }
 * Positioned at `at` ({x, y}) or below `anchor` (DOMRect).
 */
export function Menu({ items, at, anchor, onClose, align = 'left', level = 0 }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  const [sub, setSub] = useState(null); // { index, rect }
  const [active, setActive] = useState(-1);
  const subTimer = useRef(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left;
    let top;
    if (anchor) {
      if (level > 0) {
        left = anchor.right - 4;
        top = anchor.top - 6;
        if (left + w > window.innerWidth - 8) left = anchor.left - w + 4;
      } else {
        left = align === 'right' ? anchor.right - w : anchor.left;
        top = anchor.bottom + 4;
      }
    } else {
      left = at.x;
      top = at.y;
    }
    left = Math.max(6, Math.min(left, window.innerWidth - w - 6));
    if (top + h > window.innerHeight - 6) {
      // Anchored top-level menus flip above their trigger; others slide up.
      top = anchor && level === 0 && anchor.top - h - 4 > 6 ? anchor.top - h - 4 : Math.max(6, window.innerHeight - h - 6);
    }
    setPos({ left, top });
  }, [anchor, at, align, level, items]);

  useEffect(() => {
    if (level > 0) return;
    const onDown = (e) => {
      if (!e.target.closest('.menu') && !e.target.closest('.menu-trigger')) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    const onBlur = () => onClose();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
    };
  }, [onClose, level]);

  const openSub = (i, target) => {
    clearTimeout(subTimer.current);
    subTimer.current = setTimeout(() => setSub({ index: i, rect: target.getBoundingClientRect() }), 90);
  };

  return createPortal(
    <div className="menu" ref={ref} style={pos} onMouseDown={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        if (it.separator) return <div key={i} className="menu-sep" />;
        if (it.heading) return <div key={i} className="menu-heading">{it.heading}</div>;
        const hasSub = !!it.items;
        return (
          <button
            key={i}
            className={`menu-item ${sub && sub.index === i ? 'active' : ''}`}
            disabled={it.disabled}
            onMouseEnter={(e) => {
              setActive(i);
              if (hasSub) openSub(i, e.currentTarget);
              else {
                clearTimeout(subTimer.current);
                setSub(null);
              }
            }}
            onClick={(e) => {
              if (hasSub) {
                setSub({ index: i, rect: e.currentTarget.getBoundingClientRect() });
                return;
              }
              onClose(true);
              it.onClick && it.onClick();
            }}
            data-active={active === i}
          >
            <span className="mi-icon">{it.checked ? <Check size={14} /> : it.icon || null}</span>
            <span className="mi-label">{it.label}</span>
            {it.shortcut && <span className="mi-shortcut">{it.shortcut}</span>}
            {hasSub && <ChevronRight size={14} className="mi-shortcut" />}
          </button>
        );
      })}
      {sub && items[sub.index] && items[sub.index].items && (
        <Menu items={items[sub.index].items} anchor={sub.rect} level={level + 1} onClose={onClose} />
      )}
    </div>,
    document.body,
  );
}

export function Progress({ value }) {
  if (value == null) return <div className="progress indeterminate" />;
  return (
    <div className="progress">
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function EmptyState({ icon, title, children }) {
  return (
    <div className="pdf-empty">
      <div>
        <div className="big-icon">{icon}</div>
        <div style={{ fontWeight: 650, fontSize: 15, color: 'var(--text)', marginBottom: 6 }}>{title}</div>
        <div style={{ maxWidth: 360, margin: '0 auto' }}>{children}</div>
      </div>
    </div>
  );
}
