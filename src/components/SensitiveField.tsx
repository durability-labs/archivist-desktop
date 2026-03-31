import { useState, useEffect } from 'react';

const STORAGE_KEY = 'sensitive_fields_global_visible';

interface SensitiveFieldProps {
  value: string;
  copyable?: boolean;
  onCopy?: () => void;
  className?: string;
  monospace?: boolean;
}

export default function SensitiveField({ value, copyable, onCopy, className, monospace = true }: SensitiveFieldProps) {
  const [visible, setVisible] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  });

  useEffect(() => {
    const handler = () => {
      setVisible(localStorage.getItem(STORAGE_KEY) === 'true');
    };
    window.addEventListener('storage', handler);
    window.addEventListener('sensitive-toggle', handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('sensitive-toggle', handler);
    };
  }, []);

  const toggle = () => {
    const next = !visible;
    setVisible(next);
    localStorage.setItem(STORAGE_KEY, String(next));
    window.dispatchEvent(new Event('sensitive-toggle'));
  };

  const masked = '\u2022'.repeat(Math.min(value.length, 24));

  return (
    <span className={`sensitive-field ${className || ''}`}>
      <code className={monospace ? '' : 'no-mono'} style={!visible ? { letterSpacing: '0.1em' } : undefined}>
        {visible ? value : masked}
      </code>
      <button
        className="sensitive-toggle"
        onClick={toggle}
        title={visible ? 'Hide sensitive data' : 'Show sensitive data'}
        type="button"
      >
        {visible ? '\uD83D\uDC41' : '\uD83D\uDC41\u200D\uD83D\uDDE8'}
      </button>
      {copyable && (
        <button
          className="sensitive-copy"
          onClick={() => {
            navigator.clipboard.writeText(value);
            onCopy?.();
          }}
          title="Copy to clipboard"
          type="button"
        >
          Copy
        </button>
      )}
    </span>
  );
}
