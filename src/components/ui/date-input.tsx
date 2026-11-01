import { useState, type ComponentProps } from "react";
import { formatDate, maskDate, parseDate } from "@/lib/date";
import { Input } from "@/components/ui/input";

type DateInputProps = Omit<ComponentProps<typeof Input>, "type" | "value" | "onChange"> & { value: string; onValueChange: (value: string) => void };

export function DateInput({ value, onValueChange, ...props }: DateInputProps) {
  const [display, setDisplay] = useState(() => value ? formatDate(value, "") : "");
  return <Input {...props} type="text" inputMode="numeric" autoComplete="off" placeholder="дд/мм/рррр" maxLength={10} pattern="\d{2}/\d{2}/\d{4}" value={display} onChange={(event) => {
    const next = maskDate(event.target.value);
    setDisplay(next);
    onValueChange(parseDate(next));
  }} />;
}
