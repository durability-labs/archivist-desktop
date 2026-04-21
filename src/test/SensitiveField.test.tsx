import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SensitiveField from '../components/SensitiveField';

describe('SensitiveField', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders masked value by default', () => {
    render(<SensitiveField value="secret-peer-id-12345" />);
    // Should show dots, not the actual value
    expect(screen.queryByText('secret-peer-id-12345')).not.toBeInTheDocument();
    expect(screen.getByTitle('Show sensitive data')).toBeInTheDocument();
  });

  it('reveals value when toggle is clicked', () => {
    render(<SensitiveField value="my-secret" />);
    fireEvent.click(screen.getByTitle('Show sensitive data'));
    expect(screen.getByText('my-secret')).toBeInTheDocument();
    expect(screen.getByTitle('Hide sensitive data')).toBeInTheDocument();
  });

  it('hides value when toggle is clicked again', () => {
    render(<SensitiveField value="my-secret" />);
    const toggle = screen.getByTitle('Show sensitive data');
    fireEvent.click(toggle); // reveal
    fireEvent.click(screen.getByTitle('Hide sensitive data')); // hide
    expect(screen.queryByText('my-secret')).not.toBeInTheDocument();
  });

  it('persists visibility state in localStorage', () => {
    render(<SensitiveField value="test" />);
    fireEvent.click(screen.getByTitle('Show sensitive data'));
    expect(localStorage.getItem('sensitive_fields_global_visible')).toBe('true');
  });

  it('reads initial state from localStorage', () => {
    localStorage.setItem('sensitive_fields_global_visible', 'true');
    render(<SensitiveField value="visible-value" />);
    expect(screen.getByText('visible-value')).toBeInTheDocument();
  });

  it('renders copy button when copyable is true', () => {
    render(<SensitiveField value="copyable-value" copyable />);
    expect(screen.getByTitle('Copy to clipboard')).toBeInTheDocument();
  });

  it('does not render copy button when copyable is false', () => {
    render(<SensitiveField value="no-copy" />);
    expect(screen.queryByTitle('Copy to clipboard')).not.toBeInTheDocument();
  });

  it('masks long values to max 24 dots', () => {
    const longValue = 'a'.repeat(50);
    const { container } = render(
      <SensitiveField value={longValue} />
    );
    const code = container.querySelector('code');
    // Masked text should be 24 bullet characters
    expect(code?.textContent).toBe('\u2022'.repeat(24));
  });

  it('applies custom className', () => {
    const { container } = render(
      <SensitiveField value="test" className="custom-class" />
    );
    expect(container.querySelector('.sensitive-field.custom-class')).toBeInTheDocument();
  });
});
