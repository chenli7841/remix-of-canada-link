// ship 客户身份解析/建档——找有则用，没有则建一条"纯技术性、明确禁止登录"的本地
// 档案，让 ship 客户能复用现有 profiles/waybills/orders 体系（后台能像看普通客户一样
// 看他们），但这个人自己永远登录不了这个账号。
//
// 设计依据见 docs/ship-api/system-change-guide-v3.md 第 3 节 + 与用户确认的补充：
//   - profiles.id 是外键指向 auth.users(id)，必须先有真实 Auth 记录才能插 profiles。
//   - 不能拿 ship 客户的真实邮箱去建 auth.users：真邮箱可能已经是别的账号，会撞唯一
//     约束，而且我们本来就不该按邮箱匹配复用老用户。改用站内占位邮箱
//     `${partnerKey}+${externalCustomerId}@partners.invalid`（.invalid 是 RFC 2606
//     保留的"明确无效"顶级域，不会被真实解析）。
//   - email_confirm:true 建号、不设密码、外加 ban_duration 永久封禁——三重保证这个
//     账号不可能被用来登录，不是靠"没人知道占位邮箱"这种隐蔽性。
//   - 现有 handle_new_user() 触发器会在 auth.users 插入后自动建好 profiles（含
//     customer_code/username/wallet/customer 角色），不需要自己重新实现这些。
//   - 并发首单去重靠数据库唯一约束决定胜负，不是"先查询再插入"：两边都尝试建号+
//     插映射，输的一方把自己刚建的、没被引用的 auth 用户删掉（不碰任何已存在用户），
//     改用赢家的 local_user_id。

const PARTNER_EMAIL_DOMAIN = "partners.invalid";
// 100 年，等价于"永久封禁"——Supabase 的 ban_duration 不接受字面意义的 "forever"，
// 用一个足够长的时长代替。
const PERMANENT_BAN_DURATION = "876000h";

function sanitizeForEmailLocalPart(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
  return cleaned || "unknown";
}

function syntheticEmailFor(partnerKey: string, externalCustomerId: string): string {
  return `${sanitizeForEmailLocalPart(partnerKey)}+${sanitizeForEmailLocalPart(externalCustomerId)}@${PARTNER_EMAIL_DOMAIN}`;
}

export type FindOrCreateShipCustomerInput = {
  partnerKey: string;
  externalCustomerId: string;
  name: string;
  phone: string;
  email: string | null;
};

export type FindOrCreateShipCustomerResult = {
  localUserId: string;
  customerCode: string;
  customerCreated: boolean;
};

async function fetchMapping(admin: any, partnerKey: string, externalCustomerId: string) {
  const { data, error } = await admin
    .from("partner_customer_mappings")
    .select("local_user_id")
    .eq("partner_key", partnerKey)
    .eq("external_customer_id", externalCustomerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { local_user_id: string } | null;
}

async function fetchCustomerCode(admin: any, userId: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("customer_code").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.customer_code) throw new Error(`profile ${userId} missing customer_code`);
  return data.customer_code as string;
}

// 建一条新的、明确禁止登录的本地档案；返回新 auth.users id。失败直接抛错，
// 调用方决定要不要重试——这一步本身不写 partner_customer_mappings，映射由调用方
// 在确认"赢得"这次建档竞争后再写。
async function createLockedProfile(
  admin: any,
  opts: { partnerKey: string; externalCustomerId: string; name: string; phone: string; email: string | null },
): Promise<string> {
  const syntheticEmail = syntheticEmailFor(opts.partnerKey, opts.externalCustomerId);
  const { data, error } = await admin.auth.admin.createUser({
    email: syntheticEmail,
    email_confirm: true,
    ban_duration: PERMANENT_BAN_DURATION,
    user_metadata: {
      full_name: opts.name,
      // 仅供排查问题时肉眼识别，不参与任何业务判断。
      ship_partner_key: opts.partnerKey,
      ship_external_customer_id: opts.externalCustomerId,
    },
  });
  if (error || !data?.user) throw new Error(error?.message ?? "创建合作方客户身份失败");
  const userId = data.user.id as string;

  // handle_new_user() 触发器已经用占位邮箱建好了 profiles 行；这里把真实联系方式
  // 写回去（不影响 auth.users 的登录邮箱，那个永远是占位邮箱）。
  const { error: updErr } = await admin
    .from("profiles")
    .update({
      email: opts.email || null,
      phone: opts.phone || null,
      full_name: opts.name,
    })
    .eq("id", userId);
  if (updErr) {
    // 建档本体已经成功，联系方式回写失败不应该整单失败——记下来，调用方/后续资料更新
    // 接口还有机会补上；但要打日志，不能悄悄丢。
    console.error(`[ship-api] failed to backfill contact info for ${userId}:`, updErr.message);
  }
  return userId;
}

// 只删"这次请求自己刚建的、还没被任何映射引用"的身份——绝不牵扯任何已存在用户。
async function deleteOrphanedProfile(admin: any, userId: string) {
  try {
    await admin.auth.admin.deleteUser(userId);
  } catch (e) {
    console.error(`[ship-api] failed to clean up orphaned identity ${userId}:`, e);
  }
}

export async function findOrCreateShipCustomer(
  admin: any,
  input: FindOrCreateShipCustomerInput,
): Promise<FindOrCreateShipCustomerResult> {
  const partnerKey = input.partnerKey.trim();
  const externalCustomerId = input.externalCustomerId.trim();
  if (!partnerKey || !externalCustomerId) throw new Error("partnerKey/externalCustomerId 不能为空");

  const existing = await fetchMapping(admin, partnerKey, externalCustomerId);
  if (existing) {
    const customerCode = await fetchCustomerCode(admin, existing.local_user_id);
    return { localUserId: existing.local_user_id, customerCode, customerCreated: false };
  }

  // 没找到映射——建一个新身份，然后去抢那条映射记录的唯一约束。
  const candidateUserId = await createLockedProfile(admin, {
    partnerKey,
    externalCustomerId,
    name: input.name,
    phone: input.phone,
    email: input.email,
  });

  const { error: mapErr } = await admin.from("partner_customer_mappings").insert({
    partner_key: partnerKey,
    external_customer_id: externalCustomerId,
    local_user_id: candidateUserId,
  });

  if (!mapErr) {
    // 建档同时把分级设为 ship客户——只在真正第一次建档这一刻做一次，重放请求走的是
    // 上面 fetchMapping 命中的分支，根本到不了这里，天然幂等，不需要额外判断。
    await admin.from("profiles").update({ vip_level: "ship" }).eq("id", candidateUserId);
    const customerCode = await fetchCustomerCode(admin, candidateUserId);
    return { localUserId: candidateUserId, customerCode, customerCreated: true };
  }

  // 唯一约束冲突（23505）= 另一个并发请求先建好了映射；不是 23505 的错误照常抛出。
  if ((mapErr as any).code !== "23505") {
    await deleteOrphanedProfile(admin, candidateUserId);
    throw new Error(mapErr.message);
  }

  // 输了这场竞争：清理自己刚建的、没人引用的身份，改用赢家的映射。
  await deleteOrphanedProfile(admin, candidateUserId);
  const winner = await fetchMapping(admin, partnerKey, externalCustomerId);
  if (!winner) {
    // 理论上不该发生（冲突说明赢家那行确实存在）；防御性兜底。
    throw new Error("客户映射并发冲突后未能读取到有效记录，请重试");
  }
  const customerCode = await fetchCustomerCode(admin, winner.local_user_id);
  return { localUserId: winner.local_user_id, customerCode, customerCreated: false };
}
