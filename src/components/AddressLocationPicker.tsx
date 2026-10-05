import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { locationKey } from '@/lib/canada-address';

export function AddressLocationPicker({label,value,options,onChange,disabled=false}: {label:string;value:string;options:{value:string;label:string}[];onChange:(value:string)=>void;disabled?:boolean}) {
  const [open,setOpen]=useState(false);
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild>
    <button type="button" role="combobox" aria-label={label} aria-expanded={open} disabled={disabled} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left text-sm disabled:opacity-50">
      <span>{options.find(o=>o.value===value)?.label || value || `请选择${label}`}</span><ChevronsUpDown className="h-4 w-4 shrink-0"/>
    </button>
  </PopoverTrigger><PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0"><Command filter={(value,search)=>locationKey(value).includes(locationKey(search))?1:0}>
    <CommandInput placeholder={`搜索${label}…`}/><CommandList><CommandEmpty>未找到匹配项，请核对地址。</CommandEmpty><CommandGroup>
      {options.map(o=><CommandItem key={o.value} value={o.label} onSelect={()=>{onChange(o.value);setOpen(false);}}><Check className={`mr-2 h-4 w-4 ${value===o.value?'opacity-100':'opacity-0'}`}/>{o.label}</CommandItem>)}
    </CommandGroup></CommandList>
  </Command></PopoverContent></Popover>;
}
