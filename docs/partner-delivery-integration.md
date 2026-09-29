# 同行快递报价联调

后台入口：/admin/routes/partner-settings → 派送发货地点。
负责人/管理员可检查连接和输入独立测试包裹询价，不要求既有订单。只调用 account 和 shipment/quote，不调用创建、购买或面单接口。

## 凭证
正式站开放接口：https://www.verykship.com/openapi 。选择 eplus 应用，App ID 763；App Secret 由用户自行通过眼睛按钮查看。不要重置密钥，不要粘贴到聊天或前端字段。
在项目 .env（本地）或应用实际运行服务的环境变量（线上）设置：

```
VERYKSHIP_ENV=production
VERYKSHIP_APP_ID=763
VERYKSHIP_APP_SECRET=<用户自行填写>
VERYKSHIP_PURCHASE_ENABLED=false
```

测试站必须使用独立 sandbox 凭证：VERYKSHIP_SANDBOX_APP_ID / VERYKSHIP_SANDBOX_APP_SECRET，并将 VERYKSHIP_ENV 设为 sandbox。不能混用。
TanStack 服务端调用读取应用运行环境；仅在 Supabase Edge Functions 设置密钥不会自动给本应用服务器提供凭证。

输入发货资料和测试收件地址后点击查询；缺少凭证/地址会报错。结果保留平台币种与费用口径，不重复叠加 tax。参考最低价仅在 CAD 服务中选择，不自动购买。
当前页面保存仍为本地草稿，客户端同行报价页还未连接该管理员联调入口。客户使用需要线路持久化、服务端客户权限及发货地址读取后再开放，不能直接放开管理员测试接口。

验证：node --test scripts/test-partner-delivery.mjs 和 npm run test:express。
