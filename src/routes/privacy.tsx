import { createFileRoute } from "@tanstack/react-router";
import { ChatGPTPolicyPage } from "@/components/site/ChatGPTPolicyPage";
import { privacySections } from "@/lib/chatgpt-policies";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "客服隐私政策 / Privacy — EPLUS" },
      {
        name: "description",
        content: "EPLUS ChatGPT 客服连接的个人信息处理、数据保留和用户权利说明。",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <ChatGPTPolicyPage title="EPLUS ChatGPT 客服隐私政策" sections={privacySections} />
  ),
});
