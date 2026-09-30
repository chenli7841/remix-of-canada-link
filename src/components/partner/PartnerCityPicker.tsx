import {useEffect,useId,useRef,useState} from 'react';

export function PartnerCityPicker({cities,value,onChange,disabled=false}:{cities:string[];value:string;onChange:(city:string)=>void;disabled?:boolean}){
 const [query,setQuery]=useState(value),[open,setOpen]=useState(false),[active,setActive]=useState(-1);
 const input=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null),id=useId();
 const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 const matches=cities.filter(city=>normalize(city).includes(normalize(query)));
 useEffect(()=>{if(value)setQuery(value);},[value]);
 useEffect(()=>{input.current?.setCustomValidity(value?'':'请输入城市名，并从列表选择城市');},[value,query]);
 useEffect(()=>{list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});},[active]);
 const choose=(city:string)=>{setQuery(city);onChange(city);setOpen(false);setActive(-1);};
 return <div className="partner-city-picker">
  <input ref={input} role="combobox" aria-label="城市" aria-autocomplete="list" aria-expanded={open} aria-controls={id} aria-activedescendant={open&&active>=0?`${id}-${active}`:undefined} required disabled={disabled} autoComplete="off" placeholder={disabled?'请选择省份':'输入城市名称后选择'} value={query}
   onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)}
   onChange={e=>{setQuery(e.target.value);onChange('');setOpen(true);setActive(-1);}}
   onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);setActive(i=>Math.max(0,Math.min(matches.length-1,i+(e.key==='ArrowDown'?1:-1))));}else if(e.key==='Enter'&&open){e.preventDefault();if(matches[active])choose(matches[active]);}else if(e.key==='Escape'){e.preventDefault();setOpen(false);}}}/>
  {open&&!disabled&&<div id={id} ref={list} role="listbox" aria-label="城市选项" className="partner-city-options">{matches.map((city,i)=><div id={`${id}-${i}`} key={city} role="option" aria-selected={active===i} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(city)}>{city}</div>)}{!matches.length&&<p role="status">未找到匹配城市，请调整关键词。</p>}</div>}
 </div>;
}
