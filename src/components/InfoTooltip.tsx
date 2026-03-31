interface InfoTooltipProps {
  text: string;
}

export default function InfoTooltip({ text }: InfoTooltipProps) {
  return (
    <span className="info-tooltip">
      <span className="info-tooltip-icon">?</span>
      <span className="info-tooltip-text">{text}</span>
    </span>
  );
}
