-- 现有无群名记录直接进入屏蔽列表；后续可在“已屏蔽群”刷新群名后人工取消屏蔽。
update public.wecom_notify_groups
set is_blocked = true,
    blocked_at = coalesce(blocked_at, now()),
    blocked_by = null
where trim(coalesce(name, '')) = ''
   or name = '（企业微信未返回群名）';
