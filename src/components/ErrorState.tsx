import { Link } from 'react-router-dom';
import '../styles/ErrorState.css';

interface ErrorAction {
  label: string;
  onClick?: () => void;
  to?: string;
  variant?: 'primary' | 'secondary';
}

interface ErrorStateProps {
  title?: string;
  message: string;
  details?: string;
  actions?: ErrorAction[];
  icon?: 'error' | 'warning' | 'info' | 'offline';
}

const icons = {
  error: (
    <svg viewBox="0 0 24 24" width="48" height="48" className="error-icon error">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 24 24" width="48" height="48" className="error-icon warning">
      <path d="M12 2L2 22h20L12 2z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" width="48" height="48" className="error-icon info">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  offline: (
    <svg viewBox="0 0 24 24" width="48" height="48" className="error-icon offline">
      <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.58 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  ),
};

function ErrorState({ title, message, details, actions = [], icon = 'error' }: ErrorStateProps) {
  return (
    <div className="error-state">
      <div className="error-state-icon">
        {icons[icon]}
      </div>
      {title && <h3 className="error-state-title">{title}</h3>}
      <p className="error-state-message">{message}</p>
      {details && (
        <div className="error-state-details">
          <code>{details}</code>
        </div>
      )}
      {actions.length > 0 && (
        <div className="error-state-actions">
          {actions.map((action, index) => (
            action.to ? (
              <Link
                key={index}
                to={action.to}
                className={`btn-error-action ${action.variant || 'primary'}`}
              >
                {action.label}
              </Link>
            ) : (
              <button
                key={index}
                onClick={action.onClick}
                className={`btn-error-action ${action.variant || 'primary'}`}
              >
                {action.label}
              </button>
            )
          ))}
        </div>
      )}
    </div>
  );
}

export default ErrorState;
