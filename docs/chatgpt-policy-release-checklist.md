# 客服政策页面发布交接

## 最新提交检查（替代下文历史状态）

- 演示视频已上传 Google Drive，设置为知道链接的人只读，并已在 OpenAI Demo Recording URL 保存。
- OpenAI Submit 页仍提示 Info / Submit confirmation required，Submit for Review 按钮禁用；尚未提交审核。
- 运营方已确认人工隐私申请及清理流程落实，进一步确认审计记录 12 个月、文件随关联记录期限处理。已结合官方服务商说明完成本地正式政策（2026-09-18），同步正文、生效日期和草稿开关；线上仍待用户上传更新。
- 服务商日志采用有来源的保留标准，不虚构所有副本固定到期删除或全部驻留加拿大。来源见基础设施核实记录及政策链接。
- 运营方已明确确认 yanze 仅含内部演示资料、不含真实客户数据并允许审核使用。Testing 凭证已从先前管理员账号改为 yanze，刷新核对保存成功。密码仅填入门户，未保存到仓库。
- 身份用例已更新为已确认的 customer 演示账号；剩余用例仍需完成逐项回归，不能把预期行为或本次文案变更当作测试通过。
- 最后商业及合规声明应在资料真实完整后，由运营方审阅确认；尚未勾选。

以下保留为历史交接记录，涉及尚未发布网址、尚未填写网址或流程未确认的描述以上述最新状态为准。

2026-09-18：已新增 `/privacy` 和 `/terms` 两个无需登录的页面，以及登录页和页脚入口。当前是明确标记的待生效稿，不等于已经满足公开上架要求。仅适用于 EPLUS ChatGPT 客服连接，不替代商城全站、广告统计、支付或运输合同政策。

正文唯一实现来源：`src/lib/chatgpt-policies.ts`。此前 `chatgpt-privacy-policy-review.md` 和 `chatgpt-terms-review.md` 为历史讨论稿，不要把它们当成已生效版本。

## 已采用的事实与方案

更新：已在 Lovable / Supabase 设置中核实主数据库为加拿大中部 ca-central-1，当前 Pro 每日备份窗口 7 天，未启用 PITR，数据库备份不包含 Storage 文件。平台 API/数据库日志的套餐窗口为 7 天。证据及边界见 `chatgpt-infrastructure-verification.md`；业务审计记录、其他处理商安排和实际执行流程仍未确认。

- 主体：eplus international service inc.；客服及隐私邮箱：epluscanada001@gmail.com。
- 公司网站：https://shopper.epluscanada.com。
- 使用 OAuth、Supabase、Lovable 和 ChatGPT；未承诺任何未经核实的数据所在地。
- 运营方选定的保留方案：客服结案后 12 个月、未确认草稿最后修改后 90 天、注销获准后 30 天清理不必保留资料、隐私申请收到后 30 天实质答复。正文明确方案尚待落实。
- 条款不虚构运输退款规则、强制仲裁、责任上限、客服即时响应或已完成的跨地区合规认证。

## 转为正式版前需要完成

1. 记录隐私邮箱实际负责人及执行流程。按照 `chatgpt-privacy-operations.md` 验证申请登记、身份核验、资料清理和异常留存流程；人工执行可以，但不能只修改文案。
2. 在 Supabase / Lovable 实际项目设置或服务商确认中核实存储/处理地区、备份轮换和日志/审计保留周期，并保存证据。不能凭域名或供应商总部推断。
3. 核实公司发布身份和主体信息，以及实际物流规则可通过客服书面取得。上线地区按实际准备情况选择。
4. 按核实结果更新正文，移除“拟实施/待核实”文字；填写实际生效日期，更新 `policyStatus.draft`，同步清理各页正文的草稿标记。不要只关闭提示横幅。
5. 用户上传发布后，匿名访问 `/privacy` 和 `/terms`，检查两页及互相链接可用；再把最终公开网址填入 OpenAI App Info。当前没有填写门户政策网址，也没有提交审核。

## 发布后的网址

- 隐私政策：https://china-to-canada-connect.lovable.app/privacy
- 客服条款：https://china-to-canada-connect.lovable.app/terms

这些是部署后的预期地址，本地完成不表示线上已经存在。更换域名时需更新门户链接及服务配置。

## 起草参考

- 加拿大隐私专员办公室，访问申请及答复要求：https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/principles/p_access/
- 跨境处理透明度：https://www.priv.gc.ca/en/privacy-topics/airports-and-borders/gl_dab_090127/
- 保留和销毁原则：https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/appropriate-handling-of-personal-information/gd_rd_201406/

以上参考不证明本项目已满足所有适用法律。具体业务的最终适用规则可由熟悉公司所在地及服务地区的法律顾问核对。
