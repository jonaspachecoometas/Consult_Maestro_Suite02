import { forwardRef, useEffect, useState } from "react";
import { Input } from "./input";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Calendar } from "./calendar";
import { Button } from "./button";
import { CalendarIcon } from "lucide-react";
import { ptBR } from "date-fns/locale";

export function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

const isoToBr = formatDateBR;

function brToIso(br: string): string | null {
  if (!br) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br);
  if (!m) return null;
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const yyyy = parseInt(m[3], 10);
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;
  if (yyyy < 1900 || yyyy > 2999) return null;
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (
    d.getUTCFullYear() !== yyyy ||
    d.getUTCMonth() !== mm - 1 ||
    d.getUTCDate() !== dd
  ) {
    return null;
  }
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function isoToDate(iso: string | null | undefined): Date | undefined {
  if (!iso) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return undefined;
  const yyyy = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const dd = parseInt(m[3], 10);
  return new Date(yyyy, mm - 1, dd);
}

function dateToIso(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function maskBr(input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, 8);
  let out = "";
  if (digits.length >= 1) out += digits.slice(0, Math.min(2, digits.length));
  if (digits.length >= 3) out += "/" + digits.slice(2, Math.min(4, digits.length));
  if (digits.length >= 5) out += "/" + digits.slice(4, 8);
  return out;
}

export interface DateInputBRProps
  extends Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type" | "defaultValue"> {
  value?: string | null;
  onChange: (isoValue: string) => void;
  /** Esconde o botão de seletor de calendário (default: false) */
  hidePicker?: boolean;
}

export const DateInputBR = forwardRef<HTMLInputElement, DateInputBRProps>(
  ({ value, onChange, className, onBlur, hidePicker, ...props }, ref) => {
    const [text, setText] = useState<string>(isoToBr(value));
    const [open, setOpen] = useState(false);

    useEffect(() => {
      setText(isoToBr(value));
    }, [value]);

    const selectedDate = isoToDate(value || undefined);

    return (
      <div className="relative w-full">
        <Input
          {...props}
          ref={ref}
          type="text"
          inputMode="numeric"
          placeholder="dd/mm/aaaa"
          maxLength={10}
          className={cn(hidePicker ? "" : "pr-8", className)}
          value={text}
          onChange={(e) => {
            const masked = maskBr(e.target.value);
            setText(masked);
            if (masked.length === 0) {
              onChange("");
              return;
            }
            if (masked.length === 10) {
              const iso = brToIso(masked);
              if (iso) onChange(iso);
            }
          }}
          onBlur={(e) => {
            if (text.length === 0) {
              onChange("");
            } else {
              const iso = brToIso(text);
              if (!iso) {
                setText("");
                onChange("");
              } else {
                onChange(iso);
              }
            }
            onBlur?.(e);
          }}
        />
        {!hidePicker && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                tabIndex={-1}
                aria-label="Abrir calendário"
                className="absolute right-0 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-foreground"
                data-testid="button-open-calendar"
              >
                <CalendarIcon className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-auto p-0"
              align="end"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <Calendar
                mode="single"
                locale={ptBR}
                selected={selectedDate}
                defaultMonth={selectedDate}
                onSelect={(d) => {
                  if (d) {
                    const iso = dateToIso(d);
                    setText(isoToBr(iso));
                    onChange(iso);
                    setOpen(false);
                  }
                }}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
    );
  },
);
DateInputBR.displayName = "DateInputBR";
