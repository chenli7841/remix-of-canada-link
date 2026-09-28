/** Always distinguish the two languages; legacy imports may have English in name_zh. */
export function HsCodeNames({ nameZh, nameEn }: { nameZh?: string | null; nameEn?: string | null }) {
  const chinese = /[\u3400-\u9fff]/.test(nameZh ?? "") ? nameZh?.trim() : "";
  const english = nameEn?.trim() || (!chinese ? nameZh?.trim() : "");
  return <span className="block min-w-0 break-words">
    <span className="block"><span className="mr-1 text-[10px] text-slate-400">中</span>{chinese || "中文名待补充"}</span>
    <span className="mt-0.5 block text-[11px] text-slate-400"><span className="mr-1 text-[10px]">EN</span>{english || "英文名待补充"}</span>
  </span>;
}
