alter table public.wecom_notify_groups
  add column if not exists owner_name text;

alter table public.wecom_daily_notification_drafts
  add column if not exists failure_reason text;

update public.wecom_daily_notification_drafts as draft
set failure_reason = case
  when not exists (
    select 1 from public.wecom_notify_bindings as binding
    where binding.customer_code = draft.customer_code
  ) then '没有绑定客户群'
  when exists (
    select 1
    from public.wecom_notify_bindings as binding
    left join public.wecom_notify_groups as notify_group on notify_group.chat_id = binding.chat_id
    where binding.customer_code = draft.customer_code
      and (notify_group.chat_id is null or notify_group.owner_userid is null)
  ) then '已绑定群，但群主 ID 尚未获取'
  else '发送失败，请刷新群资料后重试'
end
where draft.status = 'failed'
  and draft.failure_reason is null;

