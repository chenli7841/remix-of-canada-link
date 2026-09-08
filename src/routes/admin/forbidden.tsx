import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { z } from "zod";

const searchSchema = z.object({ reason: z.enum(["no-role", "page"]).optional() });

export const Route = createFileRoute("/admin/forbidden")({
  validateSearch: searchSchema,
  component: Forbidden,
});

function Forbidden() {
  const { reason } = Route.useSearch();
  const isPageRestricted = reason === "page";

  return (
    <div className="grid min-h-screen place-items-center bg-[#0B1220] p-6 text-center text-slate-100">
      <div className="max-w-md">
        <ShieldAlert className="mx-auto mb-4 h-12 w-12 text-rose-400" />
        <h1 className="font-display text-2xl font-bold">没有访问权限</h1>
        <p className="mt-2 text-sm text-slate-400">
          {isPageRestricted
            ? "你的账号角色不包含这个页面，请从左侧菜单选择你有权限的功能。"
            : "你的账号没有员工角色，无法访问管理后台。如需访问，请联系总负责人为你分配角色。"}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          {isPageRestricted ? (
            <Link to="/admin" className="rounded-md bg-white/10 px-4 py-2 text-sm hover:bg-white/15">
              返回运营概览
            </Link>
          ) : (
            <Link to="/account" className="rounded-md bg-white/10 px-4 py-2 text-sm hover:bg-white/15">
              返回我的账户
            </Link>
          )}
          <Link to="/" className="rounded-md border border-white/10 px-4 py-2 text-sm hover:bg-white/5">
            回到首页
          </Link>
        </div>
      </div>
    </div>
  );
}
