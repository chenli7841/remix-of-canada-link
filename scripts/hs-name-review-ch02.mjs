// Reviewed chapter 02 names. Generates a local review list only; never writes the DB.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const inventory = JSON.parse(fs.readFileSync('.hs-names.local/inventory.json', 'utf8'));
const sources = JSON.parse(fs.readFileSync('.hs-names.local/sources.json', 'utf8'));
const reviewed = JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json', 'utf8'));
const additions = [];
const suffixes = {
  Veal: ['小牛肉', 'Veal', ''],
  Other: ['牛肉', 'Beef', '其他'],
  'Other, processed': ['牛肉', 'Beef', '其他，经加工'],
  'Of bison': ['美洲野牛肉', 'Bison meat', ''],
  Loin: ['牛腰脊肉', 'Beef loin', '其他牛肉'],
  Rib: ['牛肋部肉', 'Beef rib', '其他牛肉'],
  Chuck: ['牛肩胛肉', 'Beef chuck', '其他牛肉'],
  Hip: ['牛臀部肉', 'Beef hip', '其他牛肉'],
  Forequarter: ['牛前四分体肉', 'Beef forequarter', '其他牛肉'],
  Hindquarter: ['牛后四分体肉', 'Beef hindquarter', '其他牛肉'],
  'Eye of round, outside round, inside round, outside flat and sirloin tip':
    ['牛后腿肉', 'Beef (eye of round, outside round, inside round, outside flat and sirloin tip)', '指定分割部位，其他牛肉'],
};
for (const row of inventory.filter(r => /^020[12]\./.test(r.hs_code) && !/[\u3400-\u9fff]/.test(r.name_zh))) {
  const description = sources[row.hs_code]?.description;
  assert.ok(description, row.hs_code);
  const parts = description.split(' - ');
  const last = parts.at(-1);
  assert.ok(suffixes[last], `${row.hs_code}: ${last}`);
  const [zh, en, qualifier] = suffixes[last];
  const frozen = row.hs_code.startsWith('0202');
  const cut = parts[1];
  const cutZh = { 'Carcasses and half-carcasses': '整胴体或半胴体', 'Other cuts with bone in': '其他带骨分割肉', Boneless: '去骨' }[cut];
  assert.ok(cutZh, cut);
  const quota = parts[2];
  assert.ok(['Within access commitment', 'Over access commitment'].includes(quota));
  additions.push({ code: row.hs_code,
    zh: `${zh}（${[frozen ? '冷冻' : '鲜或冷藏', cutZh, qualifier, quota.startsWith('Within') ? '配额内' : '配额外'].filter(Boolean).join('，')}）`,
    en: `${en} (${[frozen ? 'frozen' : 'fresh or chilled', cut.toLowerCase(), last === 'Other' ? 'other' : last === 'Other, processed' ? 'other, processed' : '', quota.toLowerCase()].filter(Boolean).join('; ')})`,
  });
}
const lines = `
0203.11.00.00|猪肉（鲜或冷藏，整胴体或半胴体）|Pork (fresh or chilled; carcasses and half-carcasses)
0203.12.00.00|猪腿肩肉（鲜或冷藏，带骨及其分割肉）|Pork hams, shoulders and cuts thereof (fresh or chilled; bone-in)
0203.19.00.10|猪腹肋排（鲜或冷藏）|Pork spare ribs (fresh or chilled)
0203.19.00.20|猪背肋排（鲜或冷藏）|Pork back ribs (fresh or chilled)
0203.19.00.91|猪肉（鲜或冷藏，其他，经加工）|Pork (fresh or chilled; other, processed)
0203.19.00.99|猪肉（鲜或冷藏，其他）|Pork (fresh or chilled; other)
0203.21.00.00|猪肉（冷冻，整胴体或半胴体）|Pork (frozen; carcasses and half-carcasses)
0203.22.00.00|猪腿肩肉（冷冻，带骨及其分割肉）|Pork hams, shoulders and cuts thereof (frozen; bone-in)
0203.29.00.10|猪腹肋排（冷冻）|Pork spare ribs (frozen)
0203.29.00.20|猪背肋排（冷冻）|Pork back ribs (frozen)
0203.29.00.90|猪肉（冷冻，其他）|Pork (frozen; other)
0204.10.00.00|羔羊肉（鲜或冷藏，整胴体或半胴体）|Lamb (fresh or chilled; carcasses and half-carcasses)
0204.21.00.00|绵羊肉（鲜或冷藏，整胴体或半胴体，非羔羊）|Sheep meat (fresh or chilled; carcasses and half-carcasses, other than lamb)
0204.22.00.00|绵羊肉（鲜或冷藏，其他带骨分割肉）|Sheep meat (fresh or chilled; other bone-in cuts)
0204.23.00.00|绵羊肉（鲜或冷藏，去骨）|Sheep meat (fresh or chilled; boneless)
0204.30.00.00|羔羊肉（冷冻，整胴体或半胴体）|Lamb (frozen; carcasses and half-carcasses)
0204.41.00.00|绵羊肉（冷冻，整胴体或半胴体，非羔羊）|Sheep meat (frozen; carcasses and half-carcasses, other than lamb)
0204.42.10.00|羔羊肉（冷冻，其他带骨分割肉）|Lamb (frozen; other bone-in cuts)
0204.42.20.00|成年绵羊肉（冷冻，其他带骨分割肉）|Mutton (frozen; other bone-in cuts)
0204.43.10.00|羔羊肉（冷冻，去骨）|Lamb (frozen; boneless)
0204.43.20.00|成年绵羊肉（冷冻，去骨）|Mutton (frozen; boneless)
0204.50.00.00|山羊肉（鲜、冷藏或冷冻）|Goat meat (fresh, chilled or frozen)
0205.00.00.00|马驴骡肉（含驴骡，鲜、冷藏或冷冻）|Meat of horses, asses, mules or hinnies (fresh, chilled or frozen)
0206.10.00.00|牛食用杂碎（鲜或冷藏）|Edible bovine offal (fresh or chilled)
0206.21.00.00|牛舌（冷冻，食用）|Bovine tongues (frozen; edible)
0206.22.00.00|牛肝（冷冻，食用）|Bovine livers (frozen; edible)
0206.29.00.00|牛食用杂碎（冷冻，其他）|Edible bovine offal (frozen; other)
0206.30.00.00|猪食用杂碎（鲜或冷藏）|Edible swine offal (fresh or chilled)
0206.41.00.00|猪肝（冷冻，食用）|Swine livers (frozen; edible)
0206.49.00.00|猪食用杂碎（冷冻，其他）|Edible swine offal (frozen; other)
0206.80.00.00|羊马驴骡食用杂碎（鲜或冷藏）|Edible offal of sheep, goats, horses, asses, mules or hinnies (fresh or chilled)
0206.90.00.00|羊马驴骡食用杂碎（冷冻）|Edible offal of sheep, goats, horses, asses, mules or hinnies (frozen)
`;
for (const line of lines.trim().split('\n')) {
  const [code, zh, en] = line.split('|');
  assert.ok(code && zh && en);
  additions.push({code, zh, en});
}
assert.equal(additions.length, 78);
const add = (code, zh, en, detail) => additions.push({ code, zh, en, ...(detail ? {detail} : {}) });
const quotaPairs = [['91', '配额内', 'within access commitment'], ['92', '配额外', 'over access commitment']];
for (const [prefix, zhState, enState] of [['0207.11', '鲜或冷藏', 'fresh or chilled'], ['0207.12', '冷冻', 'frozen']]) {
  add(`${prefix}.10.00`, `整鸡（淘汰鸡，${zhState}）`, `Whole spent fowl (${enState})`);
  for (const [suffix, zq, eq] of quotaPairs) add(`${prefix}.${suffix}.00`, `整鸡（其他，${zhState}，${zq}）`, `Whole chicken (other; ${enState}; ${eq})`);
}
add('0207.13.10.00', '鸡分割肉及食用杂碎（淘汰鸡，鲜或冷藏）', 'Chicken cuts and edible offal (spent fowl; fresh or chilled)');
for (const [suffix, zq, eq] of [['91','配额内','within access commitment'], ['92','配额外，带骨','over access commitment, bone-in'], ['93','配额外，去骨','over access commitment, boneless']]) {
  add(`0207.13.${suffix}.00`, `鸡分割肉及食用杂碎（其他，鲜或冷藏，${zq}）`, `Chicken cuts and edible offal (other; fresh or chilled; ${eq})`);
}
const chickenParts = [
  ['10', '鸡腿四分体', 'Chicken leg quarters'],
  ['20', '鸡腿（不含腿四分体）', 'Chicken legs (excluding leg quarters)'],
  ['30', '鸡翅及翅尖、翅部', 'Chicken wings, wing tips or parts thereof'],
];
for (const [suffix, zh, en] of chickenParts) {
  add(`0207.14.10.${suffix}`, `${zh}（淘汰鸡，冷冻）`, `${en} (spent fowl; frozen)`);
  add(`0207.14.91.${suffix}`, `${zh}（其他鸡，冷冻，配额内）`, `${en} (other chicken; frozen; within access commitment)`);
}
add('0207.14.10.40', '鸡食用杂碎（淘汰鸡，冷冻）', 'Edible chicken offal (spent fowl; frozen)');
add('0207.14.10.90', '鸡分割肉及食用杂碎（淘汰鸡，冷冻，其他）', 'Chicken cuts and edible offal (spent fowl; frozen; other)');
add('0207.14.21.00', '鸡肝（冷冻，配额内）', 'Chicken livers (frozen; within access commitment)');
add('0207.14.22.00', '鸡肝（冷冻，配额外）', 'Chicken livers (frozen; over access commitment)');
add('0207.14.91.41', '鸡爪（其他鸡，冷冻，配额内）', 'Chicken feet (other chicken; frozen; within access commitment)');
add('0207.14.91.49', '鸡食用杂碎（其他鸡，冷冻，其他，配额内）', 'Edible chicken offal (other chicken; frozen; other; within access commitment)');
add('0207.14.91.90', '鸡分割肉及食用杂碎（其他，冷冻，配额内）', 'Chicken cuts and edible offal (other; frozen; within access commitment)');
add('0207.14.92.00', '鸡分割肉及食用杂碎（其他，冷冻，带骨，配额外）', 'Chicken cuts and edible offal (other; frozen; bone-in; over access commitment)');
add('0207.14.93.00', '鸡分割肉及食用杂碎（其他，冷冻，去骨，配额外）', 'Chicken cuts and edible offal (other; frozen; boneless; over access commitment)');
for (const [prefix, zs, es] of [['0207.24','鲜或冷藏','fresh or chilled'], ['0207.25','冷冻','frozen']]) {
  for (const [suffix, zq, eq] of quotaPairs) {
    add(`${prefix}.${suffix}.00`, `整火鸡（其他，${zs}，${zq}）`, `Whole turkey (other; ${es}; ${eq})`);
    add(`${prefix}.${suffix === '91' ? '11' : '12'}.00`, `整火鸡（加工用，去颈及内脏，${zs}，${zq}）`, `Whole turkey (canner pack; ${es}; ${eq})`,
      'Canner pack 指去颈及内脏、供进一步加工而非消费者市场的火鸡，并非罐头。定义来源：https://www.cbsa-asfc.gc.ca/publications/dm-md/d10/d10-18-8-eng.html');
  }
}
for (const [suffix,zq,eq] of [['10','配额内','within access commitment'], ['20','带骨，配额外','bone-in; over access commitment'], ['30','去骨，配额外','boneless; over access commitment']]) {
  add(`0207.26.${suffix}.00`, `火鸡分割肉及食用杂碎（鲜或冷藏，${zq}）`, `Turkey cuts and edible offal (fresh or chilled; ${eq})`);
}
add('0207.27.11.00','火鸡肝（冷冻，配额内）','Turkey livers (frozen; within access commitment)');
add('0207.27.12.00','火鸡肝（冷冻，配额外）','Turkey livers (frozen; over access commitment)');
for (const [suffix,zq,eq] of [['91','配额内','within access commitment'], ['92','带骨，配额外','bone-in; over access commitment'], ['93','去骨，配额外','boneless; over access commitment']]) {
  add(`0207.27.${suffix}.00`, `火鸡分割肉及食用杂碎（其他，冷冻，${zq}）`, `Turkey cuts and edible offal (other; frozen; ${eq})`);
}
for (const [digit,zh,en] of [['4','鸭','Duck'],['5','鹅','Goose']]) {
  add(`0207.${digit}1.00.00`, `整${zh}（鲜或冷藏）`, `Whole ${en.toLowerCase()} (fresh or chilled)`);
  add(`0207.${digit}2.00.00`, `整${zh}（冷冻）`, `Whole ${en.toLowerCase()} (frozen)`);
  add(`0207.${digit}3.00.00`, `肥${zh}肝（鲜或冷藏）`, `Fatty ${en.toLowerCase()} livers (fresh or chilled)`);
  add(`0207.${digit}4.00.00`, `${zh}肉及食用杂碎（鲜或冷藏，其他）`, `${en} meat and edible offal (fresh or chilled; other)`);
  add(`0207.${digit}5.10.00`, `${zh}肝（冷冻）`, `${en} livers (frozen)`);
  add(`0207.${digit}5.90.00`, `${zh}肉及食用杂碎（冷冻，其他）`, `${en} meat and edible offal (frozen; other)`);
}
add('0207.60.11.00','整珍珠鸡（鲜或冷藏）','Whole guinea fowl (fresh or chilled)');
add('0207.60.19.00','珍珠鸡肉及食用杂碎（鲜或冷藏，其他）','Guinea fowl meat and edible offal (fresh or chilled; other)');
add('0207.60.20.00','整珍珠鸡（冷冻）','Whole guinea fowl (frozen)');
add('0207.60.91.00','珍珠鸡肝（冷冻）','Guinea fowl livers (frozen)');
add('0207.60.99.00','珍珠鸡肉及食用杂碎（冷冻，其他）','Guinea fowl meat and edible offal (frozen; other)');
for (const [code,zh,en] of [
  ['0208.10.00.00','兔肉及食用杂碎','Rabbit or hare meat and edible offal'],
  ['0208.30.00.00','灵长类肉及食用杂碎','Primate meat and edible offal'],
  ['0208.40.10.00','鲸肉及食用杂碎','Whale meat and edible offal'],
  ['0208.40.90.00','其他指定海洋哺乳动物肉及食用杂碎','Meat and edible offal of dolphins, porpoises, manatees, dugongs, seals, sea lions or walruses'],
  ['0208.50.00.00','爬行动物肉及食用杂碎','Reptile meat and edible offal (including snakes and turtles)'],
  ['0208.60.00.00','骆驼科动物肉及食用杂碎','Camel and other camelid meat and edible offal'],
  ['0208.90.00.10','鹿肉及食用杂碎','Deer meat and edible offal'],
  ['0208.90.00.20','蛙腿','Frogs\' legs'],
  ['0208.90.00.90','其他动物肉及食用杂碎','Other animal meat and edible offal'],
]) add(code, `${zh}（鲜、冷藏或冷冻）`, `${en} (fresh, chilled or frozen)`);
const fatDetail = '本类为未经熬炼或其他方法提取的脂肪，状态包括鲜、冷藏、冷冻、盐腌、盐渍、干制或熏制。';
for (const [code,zh,en] of [
  ['0209.10.00.00','猪脂肪（不带瘦肉，未经熬炼或提取）','Pig fat (free of lean meat; not rendered or otherwise extracted)'],
  ['0209.90.10.00','鸡脂肪（未经熬炼或提取，配额内）','Chicken fat (not rendered or otherwise extracted; within access commitment)'],
  ['0209.90.20.00','鸡脂肪（未经熬炼或提取，配额外）','Chicken fat (not rendered or otherwise extracted; over access commitment)'],
  ['0209.90.30.00','火鸡脂肪（未经熬炼或提取，配额内）','Turkey fat (not rendered or otherwise extracted; within access commitment)'],
  ['0209.90.40.00','火鸡脂肪（未经熬炼或提取，配额外）','Turkey fat (not rendered or otherwise extracted; over access commitment)'],
  ['0209.90.90.00','其他禽脂肪（未经熬炼或提取）','Other poultry fat (not rendered or otherwise extracted)'],
]) add(code,zh,en,fatDetail);
for (const [code,zh,en,extraZh,extraEn] of [
  ['0210.11.00.00','猪腿肩肉','Pork hams, shoulders and cuts thereof','带骨','bone-in'],
  ['0210.12.00.00','猪五花肉及其分割肉','Pork bellies (streaky) and cuts thereof','',''],
  ['0210.19.00.00','猪肉','Pork','其他','other'],
  ['0210.20.00.00','牛肉','Bovine meat','',''],
  ['0210.99.11.00','鸡肉','Chicken meat','配额内','within access commitment'],
  ['0210.99.12.00','鸡肉','Chicken meat','带骨，配额外','bone-in; over access commitment'],
  ['0210.99.13.00','鸡肉','Chicken meat','去骨，配额外','boneless; over access commitment'],
  ['0210.99.14.00','火鸡肉','Turkey meat','配额内','within access commitment'],
  ['0210.99.15.00','火鸡肉','Turkey meat','带骨，配额外','bone-in; over access commitment'],
  ['0210.99.16.00','火鸡肉','Turkey meat','去骨，配额外','boneless; over access commitment'],
  ['0210.99.19.00','其他禽肉','Other poultry meat','',''],
]) add(code, `${zh}（盐腌、盐渍、干制或熏制${extraZh ? '，' + extraZh : ''}）`, `${en} (salted, in brine, dried or smoked${extraEn ? '; ' + extraEn : ''})`);
for (const [code,zh,en] of [
  ['0210.91.00.00','灵长类','Primates'],
  ['0210.92.00.00','指定海洋哺乳动物','Whales, dolphins, porpoises, manatees, dugongs, seals, sea lions or walruses'],
  ['0210.93.00.00','爬行动物','Reptiles (including snakes and turtles)'],
  ['0210.99.90.00','其他动物','Other animals'],
]) add(code,`${zh}肉及食用杂碎（腌、干或熏制，含食用肉粉）`,`${en}: meat and edible offal (salted, in brine, dried or smoked; including edible flours and meals)`,
  '包含盐腌、盐渍、干制或熏制肉及食用杂碎，以及肉或杂碎制成的食用细粉、粗粉；完整动物范围见原分类。');
assert.equal(additions.length, 166);
for (const entry of additions) {
  assert.ok(sources[entry.code], entry.code);
  assert.ok(inventory.some(r => r.hs_code === entry.code && !/[\u3400-\u9fff]/.test(r.name_zh)), entry.code);
  const existing = reviewed.find(r => r.code === entry.code);
  if (existing) assert.deepEqual(existing, entry);
  else reviewed.push(entry);
}
fs.writeFileSync('scripts/hs-names-reviewed.json', JSON.stringify(reviewed, null, 2) + '\n');
console.log(`Reviewed ${additions.length} chapter 02 names; total reviewed ${reviewed.length}.`);
