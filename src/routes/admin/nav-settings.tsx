import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { listNavItems, saveNavConfig, type NavItemRow } from "@/lib/admin-nav.functions";
import { ROLE_LABEL, ASSIGNABLE_ROLES } from "@/lib/admin-roles";
import type { AppRole } from "@/lib/admin.functions";
import { Loader2, Save, RotateCcw, ChevronUp, ChevronDown, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/admin/nav-settings")({
  head: () => ({
    meta: [{ title: "菜单权限设置 — SinoCargo Admin" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  component: NavSettingsPage,
});

// Owner-only editor for admin_nav_items: which roles can see each sidebar
// link, which category it's grouped under, and the display order of both
// groups and items. saveNavConfig on the server re-checks the owner role —
// this page being hidden from everyone else is not what actually enforces it.
function NavSettingsPage() {
  const qc = useQueryClient();
  const fetchItems = useServerFn(listNavItems);
  const save = useServerFn(saveNavConfig);

  const q = useQuery({ queryKey: ["admin-nav-items"], queryFn: () => fetchItems() });
  const [items, setItems] = useState<NavItemRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (q.data) setItems(q.data.items.map((it) => ({ ...it, roles: [...it.roles] })));
  }, [q.data]);

  const groups = useMemo(() => {
    if (!items) return [];
    const byTitle = new Map<string, NavItemRow[]>();
    for (const it of items) {
      const arr = byTitle.get(it.group_title) ?? [];
      arr.push(it);
      byTitle.set(it.group_title, arr);
    }
    return Array.from(byTitle.entries())
      .map(([title, its]) => ({
        title,
        sort: its[0]?.group_sort_order ?? 0,
        items: its.slice().sort((a, b) => a.item_sort_order - b.item_sort_order),
      }))
      .sort((a, b) => a.sort - b.sort);
  }, [items]);

  const groupTitles = groups.map((g) => g.title);

  const toggleRole = (id: string, role: AppRole) => {
    setItems((prev) =>
      (prev ?? []).map((it) =>
        it.id === id
          ? {
              ...it,
              roles: it.roles.includes(role) ? it.roles.filter((r) => r !== role) : [...it.roles, role],
            }
          : it,
      ),
    );
  };

  const renameGroup = (oldTitle: string, newTitle: string) => {
    setItems((prev) => (prev ?? []).map((it) => (it.group_title === oldTitle ? { ...it, group_title: newTitle } : it)));
  };

  const moveGroup = (title: string, dir: -1 | 1) => {
    const idx = groups.findIndex((g) => g.title === title);
    const otherIdx = idx + dir;
    if (idx < 0 || otherIdx < 0 || otherIdx >= groups.length) return;
    const a = groups[idx].title;
    const b = groups[otherIdx].title;
    const aSort = groups[idx].sort;
    const bSort = groups[otherIdx].sort;
    setItems((prev) =>
      (prev ?? []).map((it) => {
        if (it.group_title === a) return { ...it, group_sort_order: bSort };
        if (it.group_title === b) return { ...it, group_sort_order: aSort };
        return it;
      }),
    );
  };

  const moveItem = (groupTitle: string, itemId: string, dir: -1 | 1) => {
    const group = groups.find((g) => g.title === groupTitle);
    if (!group) return;
    const idx = group.items.findIndex((it) => it.id === itemId);
    const otherIdx = idx + dir;
    if (idx < 0 || otherIdx < 0 || otherIdx >= group.items.length) return;
    const a = group.items[idx];
    const b = group.items[otherIdx];
    setItems((prev) =>
      (prev ?? []).map((it) => {
        if (it.id === a.id) return { ...it, item_sort_order: b.item_sort_order };
        if (it.id === b.id) return { ...it, item_sort_order: a.item_sort_order };
        return it;
      }),
    );
  };

  const changeItemGroup = (itemId: string, newTitle: string) => {
    if (newTitle === "__new__") {
      const name = prompt("新分类名称：");
      if (!name || !name.trim()) return;
      newTitle = name.trim();
    }
    const existing = groups.find((g) => g.title === newTitle);
    const targetGroupSort = existing ? existing.sort : Math.max(0, ...groups.map((g) => g.sort)) + 1;
    const targetItemSort = existing ? Math.max(0, ...existing.items.map((it) => it.item_sort_order)) + 1 : 0;
    setItems((prev) =>
      (prev ?? []).map((it) =>
        it.id === itemId
          ? {
              ...it,
              group_title: newTitle,
              group_sort_order: targetGroupSort,
              item_sort_order: targetItemSort,
            }
          : it,
      ),
    );
  };

  const onSave = async () => {
    if (!items) return;
    setBusy(true);
    setMsg(null);
    try {
      await save({
        data: {
          items: items.map((it) => ({
            id: it.id,
            group_title: it.group_title,
            group_sort_order: it.group_sort_order,
            item_sort_order: it.item_sort_order,
            roles: it.roles,
          })),
        },
      });
      await qc.invalidateQueries({ queryKey: ["admin-nav-items"] });
      setMsg({ kind: "ok", text: "已保存，侧边栏会立即按新配置显示" });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? "保存失败" });
    } finally {
      setBusy(false);
    }
  };

  const onReset = () => {
    if (q.data) setItems(q.data.items.map((it) => ({ ...it, roles: [...it.roles] })));
    setMsg(null);
  };

  if (q.isError) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          加载失败：{(q.error as Error)?.message ?? "未知错误"}
          <div className="mt-1 text-xs text-rose-300/70">
            如果提示 admin_nav_items 表不存在，说明这个功能对应的数据库迁移还没有在当前环境执行。
          </div>
        </div>
      </div>
    );
  }

  if (q.isLoading || !items) {
    return (
      <div className="grid h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold inline-flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            菜单权限设置
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            勾选每个栏目哪些角色登录后能看到；也可以改它所属的分类和排序（分类 / 栏目都能上下移动）。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5"
          >
            <RotateCcw className="h-4 w-4" />
            放弃修改
          </button>
          <button
            onClick={onSave}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`mb-4 rounded-md border px-3 py-2 text-sm ${msg.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"}`}
        >
          {msg.text}
        </div>
      )}

      <div className="space-y-5">
        {groups.map((group, gi) => (
          <section key={group.title || "(未分类)"} className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
            <div className="mb-3 flex items-center gap-2">
              <input
                value={group.title}
                onChange={(e) => renameGroup(group.title, e.target.value)}
                placeholder="（无标题分类）"
                className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm font-semibold text-slate-100 focus:border-brand focus:outline-none"
              />
              <button
                disabled={gi === 0}
                onClick={() => moveGroup(group.title, -1)}
                className="rounded-md border border-white/10 p-1.5 text-slate-300 hover:bg-white/5 disabled:opacity-30"
                title="分类上移"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                disabled={gi === groups.length - 1}
                onClick={() => moveGroup(group.title, 1)}
                className="rounded-md border border-white/10 p-1.5 text-slate-300 hover:bg-white/5 disabled:opacity-30"
                title="分类下移"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="space-y-1.5">
              {group.items.map((it, ii) => (
                <div
                  key={it.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
                >
                  <div className="flex items-center gap-1">
                    <button
                      disabled={ii === 0}
                      onClick={() => moveItem(group.title, it.id, -1)}
                      className="rounded p-1 text-slate-400 hover:bg-white/10 disabled:opacity-30"
                      title="上移"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      disabled={ii === group.items.length - 1}
                      onClick={() => moveItem(group.title, it.id, 1)}
                      className="rounded p-1 text-slate-400 hover:bg-white/10 disabled:opacity-30"
                      title="下移"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>

                  <div className="min-w-[140px] text-sm font-medium text-slate-100">{it.label}</div>
                  <div className="font-mono text-[11px] text-slate-500">{it.path}</div>

                  <select
                    value={it.group_title}
                    onChange={(e) => changeItemGroup(it.id, e.target.value)}
                    className="ml-auto rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 focus:border-brand focus:outline-none [&>option]:bg-[#0E1626]"
                  >
                    {groupTitles.map((t) => (
                      <option key={t} value={t}>
                        {t || "（无标题分类）"}
                      </option>
                    ))}
                    <option value="__new__">+ 新分类…</option>
                  </select>

                  <div className="flex flex-wrap gap-2">
                    {ASSIGNABLE_ROLES.map((r) => (
                      <label
                        key={r}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${it.roles.includes(r) ? "border-brand/40 bg-brand/15 text-white" : "border-white/10 bg-white/[0.02] text-slate-500"}`}
                      >
                        <input
                          type="checkbox"
                          checked={it.roles.includes(r)}
                          onChange={() => toggleRole(it.id, r)}
                          className="h-3 w-3 accent-brand"
                        />
                        {ROLE_LABEL[r].zh}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
