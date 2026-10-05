import baseLocations from '@/components/partner/canada-locations.json';

// Confirmed postal communities and municipalities missing from the source list.
const additionalCities: Record<string, string[]> = {
  ON: ['Whitchurch-Stouffville', 'Pelham', 'Whitby', 'Trent Hills', 'Niagara-on-the-Lake', 'Clarington', 'Bradford West Gwillimbury', 'LaSalle', 'Wainfleet', 'Leeds and the Thousand Islands', 'Cavan Monaghan', 'Georgina', 'Grimsby', 'Bradford', 'West Lincoln', 'Halton Hills'],
  NS: ['North Chegoggin'],
};
const locations = baseLocations.map(p => ({ ...p, cities: [...new Set([...p.cities, ...(additionalCities[p.code] || [])])].sort((a,b)=>a.localeCompare(b)) }));

export { locations as canadaLocations };
export const locationKey = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
const provinceZh: Record<string, string> = {AB:'阿尔伯塔',BC:'不列颠哥伦比亚',MB:'曼尼托巴',NB:'新不伦瑞克',NL:'纽芬兰和拉布拉多',NS:'新斯科舍',NT:'西北地区',NU:'努纳武特',ON:'安大略',PE:'爱德华王子岛',QC:'魁北克',SK:'萨斯喀彻温',YT:'育空'};
export const provinceOptions = locations.map(p=>({value:p.code,label:`${provinceZh[p.code] || p.name} · ${p.name} (${p.code})`}));
export function normalizeCanadaAddress(address: {country?:string|null;province?:string|null;city?:string|null}) {
  const country = locationKey(address.country || '');
  if (country && !['ca','canada','加拿大'].includes(country)) return {country:address.country || '',province:address.province || '',city:address.city || '',matched:false,reason:'非加拿大地址，保留原值'};
  const provinceKey = locationKey(address.province || '');
  const cityKey = locationKey(address.city || '');
  let province = locations.find(p=>[p.code,p.name,provinceZh[p.code],provinceZh[p.code]+'省'].filter(Boolean).some(v=>locationKey(v)===provinceKey));
  // Only infer a missing province when the exact city name exists in one province.
  if (!provinceKey && cityKey) {
    const candidates = locations.filter(p=>p.cities.some(c=>locationKey(c)===cityKey));
    if(candidates.length===1) province=candidates[0];
  }
  const city = province?.cities.find(c=>locationKey(c)===cityKey);
  return {country:province ? 'CA' : address.country || '',province:province?.code || address.province || '',city:city || address.city || '',matched:!!province && !!city,reason:!province?'省份无法唯一匹配':!city?'城市未匹配，请确认准确名称':''};
}
