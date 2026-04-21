import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import InfoTooltip from '../components/InfoTooltip';

describe('InfoTooltip', () => {
  it('renders the ? icon', () => {
    render(<InfoTooltip text="Help text" />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('renders the tooltip text', () => {
    render(<InfoTooltip text="This is a helpful explanation" />);
    expect(screen.getByText('This is a helpful explanation')).toBeInTheDocument();
  });

  it('has the correct CSS classes', () => {
    const { container } = render(<InfoTooltip text="test" />);
    expect(container.querySelector('.info-tooltip')).toBeInTheDocument();
    expect(container.querySelector('.info-tooltip-icon')).toBeInTheDocument();
    expect(container.querySelector('.info-tooltip-text')).toBeInTheDocument();
  });
});
