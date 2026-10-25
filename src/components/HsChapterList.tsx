const sections: [string, number, string][] = [
  ["活动物及动物产品", 1, "活动物|肉及食用杂碎|鱼、甲壳类及软体动物|乳品、蛋、蜂蜜|其他动物产品"],
  ["植物产品", 6, "活植物及花卉|蔬菜|水果及坚果|咖啡、茶及香料|谷物|制粉产品、麦芽及淀粉|油籽、种子及饲料植物|植物胶及提取物|其他植物产品"],
  ["动植物油脂", 15, "动植物及微生物油脂和蜡"],
  ["食品、饮料及烟草", 16, "肉、鱼等制品|糖及糖食|可可及可可制品|谷物、面粉及乳制品|蔬菜、水果等制品|杂项食品|饮料、酒及醋|食品工业残渣及饲料|烟草及代用品"],
  ["矿产品", 25, "盐、硫、土石及水泥|矿砂、矿渣及矿灰|矿物燃料及矿物油"],
  ["化工产品", 28, "无机化学品|有机化学品|药品|肥料|染料、颜料及涂料|精油、香料及化妆品|肥皂、洗涤剂及蜡|蛋白类物质、胶及酶|炸药、烟火及火柴|摄影及电影用品|杂项化学产品"],
  ["塑料及橡胶", 39, "塑料及其制品|橡胶及其制品"],
  ["皮革、箱包及毛皮", 41, "生皮及皮革|皮革制品、箱包及鞍具|毛皮、人造毛皮及制品"],
  ["木材、软木及编结制品", 44, "木及木制品|软木及其制品|编结材料及篮筐制品"],
  ["纸浆、纸及印刷品", 47, "纸浆及废纸|纸、纸板及其制品|书籍、报纸及印刷品"],
  ["纺织原料及制品", 50, "丝|羊毛及动物毛|棉|其他植物纺织纤维|化学纤维长丝|化学纤维短纤|絮胎、毡、无纺布及绳索|地毯及铺地制品|特种机织物、花边及刺绣|浸渍、涂层及工业纺织物|针织及钩编织物|针织及钩编服装|非针织服装|其他纺织制品及旧衣"],
  ["鞋帽、伞及装饰制品", 64, "鞋靴及其零件|帽类|伞、手杖及鞭|羽毛、人造花及人发制品"],
  ["石材、陶瓷及玻璃", 68, "石料、石膏及水泥等制品|陶瓷产品|玻璃及其制品"],
  ["珠宝及贵金属", 71, "珍珠、宝石、贵金属及首饰"],
  ["贱金属及其制品", 72, "钢铁|钢铁制品|铜及其制品|镍及其制品|铝及其制品|保留章节|铅及其制品|锌及其制品|锡及其制品|其他贱金属及金属陶瓷|工具、刀具及餐具|杂项贱金属制品"],
  ["机械及电气设备", 84, "机械、锅炉及零件|电机、电气及音像设备"],
  ["运输设备", 86, "铁路车辆及轨道设备|车辆及其零件|航空器及航天器|船舶及浮动结构体"],
  ["仪器、钟表及乐器", 90, "光学、测量及医疗仪器|钟表及其零件|乐器及其零件"],
  ["武器及弹药", 93, "武器、弹药及零件"],
  ["杂项制品", 94, "家具、灯具及活动房屋|玩具、游戏及运动用品|杂项制成品"],
  ["艺术品及收藏品", 97, "艺术品、收藏品及古物"],
  ["加拿大特殊分类", 98, "特殊分类规定|特殊分类及减免规定"],
];

export function HsChapterList({ chapter, onChange }: { chapter: string; onChange: (chapter: string) => void }) {
  const selected = sections.flatMap(([, start, labels]) => labels.split("|").map((label, i) => ({ code: String(start + i).padStart(2, "0"), label }))).find(c => c.code === chapter);
  return (
    <details className="border-b border-white/5 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-sky-300">
        HS 分类目录 · {selected ? `${selected.code} ${selected.label}` : "全部章节"}
      </summary>
      <button type="button" onClick={() => onChange("")} aria-pressed={!chapter} className={`mt-3 rounded-md px-3 py-2 text-sm ${!chapter ? "bg-blue-600 text-white" : "bg-white/5 text-slate-300"}`}>全部章节</button>
      <div className="mt-3 grid max-h-96 gap-2 overflow-y-auto sm:grid-cols-2">
        {sections.map(([title, start, labels]) => (
          <details key={start} className="min-w-0 rounded-lg border border-white/10 p-2" open={!!chapter && Number(chapter) >= start && Number(chapter) < start + labels.split("|").length}>
            <summary className="cursor-pointer text-sm text-slate-200">{String(start).padStart(2, "0")}–{String(start + labels.split("|").length - 1).padStart(2, "0")} {title}</summary>
            <div className="mt-2 space-y-1">
              {labels.split("|").map((label, i) => {
                const code = String(start + i).padStart(2, "0");
                return <button key={code} type="button" disabled={code === "77"} aria-pressed={chapter === code} onClick={() => onChange(code)} className={`block w-full rounded px-2 py-2 text-left text-xs disabled:opacity-40 ${chapter === code ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-white/10"}`}>{code} · {label}</button>;
              })}
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}
