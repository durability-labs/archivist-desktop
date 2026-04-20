import { useState, useCallback } from 'react';

interface CidDisplayProps {
  cid: string;
  maxLength?: number;
  className?: string;
}

export default function CidDisplay({ cid, maxLength = 20, className }: CidDisplayProps) {
  const [copied, setCopied] = useState(false);

  const truncated =
    cid.length > maxLength
      ? `${cid.slice(0, 8)}...${cid.slice(-6)}`
      : cid;

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(cid);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = cid;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Silently fail if clipboard is unavailable
    }
  }, [cid]);

  return (
    <span
      onClick={handleCopy}
      title={cid}
      className={className}
      style={{
        fontFamily: 'monospace',
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'color 0.15s ease',
        color: copied ? '#00ff41' : 'inherit',
      }}
    >
      {copied ? 'Copied!' : truncated}
    </span>
  );
}
