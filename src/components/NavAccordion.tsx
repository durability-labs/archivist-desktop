import { useState, useEffect, ReactNode } from 'react';

interface NavAccordionProps {
  title: string;
  storageKey: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

function NavAccordion({ title, storageKey, defaultOpen = false, children }: NavAccordionProps) {
  const [isOpen, setIsOpen] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    return stored !== null ? stored === 'true' : defaultOpen;
  });

  useEffect(() => {
    localStorage.setItem(storageKey, String(isOpen));
  }, [storageKey, isOpen]);

  return (
    <div className={`nav-accordion ${isOpen ? 'open' : ''}`}>
      <button
        className="nav-accordion-header"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <span>{title}</span>
        <svg
          className="nav-accordion-icon"
          viewBox="0 0 24 24"
          width="16"
          height="16"
        >
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div className="nav-accordion-content">
        {children}
      </div>
    </div>
  );
}

export default NavAccordion;
