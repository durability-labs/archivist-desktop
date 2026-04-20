import { useState, useEffect, useCallback } from 'react';
import InfoTooltip from '../components/InfoTooltip';
import {
  fromBytes,
  fromSeconds,
  toBytes,
  toSeconds,
  SIZE_UNITS,
  TIME_UNITS,
  type SizeUnit,
  type TimeUnit,
} from '../lib/unitConversion';

interface UnitInputProps {
  value: string;
  onChange: (rawValue: string) => void;
  type: 'size' | 'time';
  label?: string;
  placeholder?: string;
  tooltip?: string;
  className?: string;
}

export default function UnitInput({
  value,
  onChange,
  type,
  label,
  placeholder,
  tooltip,
  className,
}: UnitInputProps) {
  const units = type === 'size' ? SIZE_UNITS : TIME_UNITS;
  const fromRaw = type === 'size' ? fromBytes : fromSeconds;

  const parsed = fromRaw(value);
  const [displayValue, setDisplayValue] = useState<string>(String(parsed.value));
  const [unit, setUnit] = useState<string>(parsed.unit);

  // Re-sync display when the raw value prop changes externally
  useEffect(() => {
    const p = fromRaw(value);
    setDisplayValue(String(p.value));
    setUnit(p.unit);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const emitChange = useCallback(
    (numStr: string, currentUnit: string) => {
      const num = parseFloat(numStr);
      if (!isNaN(num) && num >= 0) {
        const convert = type === 'size'
          ? (v: number, u: string) => toBytes(v, u as SizeUnit)
          : (v: number, u: string) => toSeconds(v, u as TimeUnit);
        onChange(convert(num, currentUnit));
      }
    },
    [onChange, type],
  );

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setDisplayValue(v);
    emitChange(v, unit);
  };

  const handleUnitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newUnit = e.target.value;
    setUnit(newUnit);
    emitChange(displayValue, newUnit);
  };

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {(label || tooltip) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {label && (
            <label style={{ fontSize: '0.85rem', opacity: 0.9 }}>{label}</label>
          )}
          {tooltip && <InfoTooltip text={tooltip} />}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          type="number"
          min="0"
          step="any"
          value={displayValue}
          onChange={handleValueChange}
          placeholder={placeholder}
          style={{ flex: 1, minWidth: 0 }}
        />
        <select value={unit} onChange={handleUnitChange}>
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
