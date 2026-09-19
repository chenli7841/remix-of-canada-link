import { createFileRoute } from "@tanstack/react-router";
import { ChatGPTPolicyPage } from "@/components/site/ChatGPTPolicyPage";
import { termsSections } from "@/lib/chatgpt-policies";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "客服服务条款 / Terms — EPLUS" },
      {
        name: "description",
        content: "EPLUS ChatGPT 客服连接的账号授权、查询、操作确认及客服服务条款。",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <ChatGPTPolicyPage title="EPLUS ChatGPT 客服服务条款" sections={termsSections} />
  ),
});
