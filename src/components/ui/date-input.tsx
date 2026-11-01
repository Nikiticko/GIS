import { useRef, useState, type ComponentProps } from "react";
import { CalendarDays } from "lucide-react";
import { formatDate, maskDate, parseDate } from "@/lib/date";
import { Input } from "@/components/ui/input";

type DateInputProps = Omit<ComponentProps<typeof Input>, "type" | "value" | "onChange"> & { value: string; onValueChange: (value: string) => void };

export function DateInput({ value, onValueChange, ...props }: DateInputProps) {
  const [display, setDisplay] = useState(() => value ? formatDate(value, "") : "");
  const picker = useRef<HTMLInputElement>(null);
  const select = (next: string) => {
    setDisplay(next ? formatDate(next, "") : "");
    onValueChange(next);
  };
  return <div className="date-input-row">
    <Input {...props} type="text" inputMode="numeric" autoComplete="off" placeholder="дд/мм/рррр" maxLength={10} pattern="\d{2}/\d{2}/\d{4}" value={display} onChange={(event) => {
      const next = maskDate(event.target.value);
      setDisplay(next);
      onValueChange(parseDate(next));
    }} />
    <button className="date-picker-button" type="button" disabled={props.disabled} aria-label="Вибрати дату в календарі" onClick={() => picker.current?.showPicker()}><CalendarDays size={16} /></button>
    <input ref={picker} className="date-picker-native" type="date" value={value} tabIndex={-1} aria-hidden="true" onChange={(event) => select(event.target.value)} />
  </div>;
}
