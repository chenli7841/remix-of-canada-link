import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { searchKnowledge } from "../knowledge-base";

export default defineTool({
  name: "search_eplus_knowledge", title: "Search EPLUS business knowledge",
  description: "Search curated EPLUS policies and service procedures before answering a general business question. It contains no live customer data, prices, permissions, balances, orders or tracking; use the relevant EPLUS tool for those.",
  inputSchema: { query: z.string().min(1).max(300), limit: z.number().int().min(1).max(8).optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }) => {
    const articles = searchKnowledge(query, limit ?? 5);
    const text = articles.length ? articles.map((article) => `【${article.title}】\n${article.content}`).join("\n\n") : "知识库没有找到直接匹配的规则。涉及实时数据时调用相应 EPLUS 工具。";
    return { content: [{ type: "text", text }], structuredContent: { articles } };
  },
});
