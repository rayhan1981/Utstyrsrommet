import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from "@/components/ui/command";
import { Check, ChevronDown } from "lucide-react";
import { sortSizesNatural } from "@/lib/sizeSort";

/**
 * Søkbar størrelses-velger for utlån/retur.
 * Viser rader som: "M – #10 – Skap B2 (8 stk)"
 * Søk filtrerer på størrelse, draktnr, lokasjon og varenr samtidig – f.eks. «M 10» finner raden.
 *
 * value = { size, jersey_number }  (jersey "X" eller "" betyr ingen draktnr)
 * onChange({ size, jersey_number })
 */
export default function SizePicker({ item, value, onChange, placeholder = "Str", testid }) {
  const [open, setOpen] = useState(false);
  const sizes = useMemo(() => sortSizesNatural(item?.sizes || [], (s) => s.size), [item]);

  const rowId = (s, i) => s.full_number || `${s.size}__${s.jersey_number || ""}__${i}`;

  const selectedIdx = sizes.findIndex(
    (s) => (s.size || "") === (value?.size || "") && (s.jersey_number || "") === (value?.jersey_number || "")
  );
  const selected = selectedIdx >= 0 ? sizes[selectedIdx] : null;

  const labelFor = (s) => {
    const jn = s.jersey_number && s.jersey_number !== "X" ? ` – #${s.jersey_number}` : "";
    const loc = s.location ? ` – ${s.location}` : "";
    return `${s.size}${jn}${loc} (${s.quantity || 0} stk)`;
  };

  // Søkestreng cmdk filtrerer på – kombiner alle felt så «M 10» finner M + #10.
  const searchStringFor = (s) => {
    const parts = [s.size, s.jersey_number && s.jersey_number !== "X" ? `#${s.jersey_number}` : "",
                   s.jersey_number && s.jersey_number !== "X" ? s.jersey_number : "",
                   s.location, s.full_number].filter(Boolean);
    return parts.join(" ");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          data-testid={testid}
          className="w-full justify-between font-normal h-10 px-3"
        >
          <span className={selected ? "truncate text-left" : "text-slate-400 truncate text-left"}>
            {selected ? labelFor(selected) : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command
          filter={(itemValue, search) => {
            // cmdk-value er en entry-id – vi oversetter til vår søkbare streng via dataset
            // Enklere: vi inkluderer søkestrengen DIREKTE i CommandItem.value nedenfor,
            // så cmdk sin default-filter funker. Dermed trenger vi egentlig ingen custom filter.
            // La standard-filter ta over når value = søkestreng.
            if (!search) return 1;
            const haystack = (itemValue || "").toLowerCase();
            const needles = search.toLowerCase().split(/\s+/).filter(Boolean);
            return needles.every((n) => haystack.includes(n)) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Søk størrelse, draktnr, lokasjon…" />
          <CommandList>
            <CommandEmpty>Ingen treff.</CommandEmpty>
            {sizes.map((s, i) => {
              const id = rowId(s, i);
              const value_ = `${id} ${searchStringFor(s)}`;
              const isSelected = selectedIdx === i;
              return (
                <CommandItem
                  key={id}
                  value={value_}
                  onSelect={() => {
                    onChange({
                      size: s.size,
                      jersey_number: s.jersey_number || (item?.is_ball ? "" : "X"),
                    });
                    setOpen(false);
                  }}
                >
                  <Check className={"mr-2 h-4 w-4 " + (isSelected ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate text-sm">{labelFor(s)}</span>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
