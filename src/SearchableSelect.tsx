import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

export interface SearchableOption {
  value: string;
  label: string;
}

interface Props {
  /** Selected option value; "" means "none selected". */
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  /** Shown in the input while nothing is selected. */
  placeholder?: string;
  ariaLabel?: string;
  /** Label of the explicit "clear selection" row shown while the query is
   *  empty (e.g. "No client" / "No client (standalone)"). Optional. */
  emptyLabel?: string;
  /** Applied to the wrapper so callers can size it in flex rows. */
  className?: string;
  id?: string;
  /** Global privacy eye: blur the input + option labels while ON. */
  piiBlur?: boolean;
}

/** Cap on rendered options; the remainder is shown as a "keep typing" hint. */
const MAX_SHOWN = 100;

/**
 * SearchableSelect — a type-to-search combobox that replaces native <select>
 * dropdowns for client pickers. Typing filters options by case-insensitive
 * substring; ArrowUp/ArrowDown move the highlight, Enter picks it, Esc closes,
 * and focus leaving the widget commits (or discards) the in-progress query.
 *
 * Value semantics match a native select: `value` only changes when an option
 * is explicitly picked (or the empty row is picked to clear); typing alone
 * never changes the selection.
 */
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "",
  ariaLabel = "Select",
  emptyLabel,
  className,
  id,
  piiBlur = false,
}: Props) {
  const labelOf = useMemo(() => {
    const byValue = new Map(options.map((o) => [o.value, o.label]));
    return (v: string) => (v === "" ? "" : byValue.get(v) ?? "");
  }, [options]);

  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => labelOf(value));
  const [hi, setHi] = useState(0);
  const openRef = useRef(open);
  openRef.current = open;
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useRef(`ss-list-${Math.random().toString(36).slice(2, 9)}`).current;

  // When the parent changes the selection externally (e.g. the quick-add form
  // resets clientId to "" after creating), sync the visible text. In-progress
  // typing is left alone so keystrokes are never clobbered.
  useEffect(() => {
    if (!openRef.current) setText(labelOf(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const q = text.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, q]);
  const shown = filtered.slice(0, MAX_SHOWN);
  const more = filtered.length - shown.length;

  // Keep the highlight in range when the list shrinks under typing.
  useEffect(() => {
    setHi((h) => Math.min(h, Math.max(0, shown.length - 1)));
  }, [shown.length]);

  function select(v: string, label: string) {
    setText(label);
    setOpen(false);
    setHi(0);
    onChange(v);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setHi(0);
        return;
      }
      if (shown.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setHi((h) => (h + step + shown.length) % shown.length);
    } else if (e.key === "Enter") {
      if (open && shown.length > 0) {
        e.preventDefault();
        const opt = shown[Math.min(hi, shown.length - 1)];
        select(opt.value, opt.label);
      } else if (!open) {
        e.preventDefault();
        setOpen(true);
        setHi(0);
      }
    } else if (e.key === "Escape") {
      if (open) {
        // Close and discard the in-progress query. stopPropagation keeps the
        // enclosing modal's own Esc-close handler from firing while a picker
        // dropdown is open.
        e.stopPropagation();
        setOpen(false);
        setText(labelOf(value));
        setHi(0);
      }
    } else if (e.key === "Tab" && open) {
      setOpen(false);
    }
  }

  function onBlur() {
    // Typing alone never changes the value: on blur the input snaps back to
    // the selected label (or empties out when nothing is selected).
    setText(labelOf(value));
    setOpen(false);
    setHi(0);
  }

  return (
    <div className={className ? `combobox ${className}` : "combobox"} id={id}>
      <input
        ref={inputRef}
        className={`combobox-input${piiBlur ? " pii-blur" : ""}`}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && shown.length > 0 ? `${listId}-o-${hi}` : undefined}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={text}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          if (!open) setOpen(true);
          setHi(0);
        }}
        onFocus={() => {
          if (!openRef.current) {
            setOpen(true);
            setHi(0);
          }
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      {open && (
        <div className="combobox-pop" role="listbox" id={listId} aria-label={ariaLabel}>
          {q === "" && emptyLabel !== undefined && (
            <div
              role="option"
              aria-selected={value === ""}
              className={`combobox-opt${value === "" ? " selected" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select("", "")}
            >
              {emptyLabel}
            </div>
          )}
          {shown.length === 0 ? (
            <div className="combobox-empty">No clients match</div>
          ) : (
            shown.map((o, i) => (
              <div
                role="option"
                key={o.value}
                aria-selected={value === o.value}
                id={`${listId}-o-${i}`}
                className={`combobox-opt${i === hi ? " active" : ""}${value === o.value ? " selected" : ""}${piiBlur ? " pii-blur" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(o.value, o.label)}
                onMouseEnter={() => setHi(i)}
              >
                {o.label}
              </div>
            ))
          )}
          {more > 0 && <div className="combobox-more">{more} more — keep typing to narrow</div>}
        </div>
      )}
    </div>
  );
}
