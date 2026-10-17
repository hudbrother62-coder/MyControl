begin;
-- Mirror only approved FAQ information into the read-only AI knowledge source.
create function public.mc_sync_faq_knowledge() returns trigger
language plpgsql security definer set search_path=public as $$
declare r jsonb; k text;
begin
 r := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 k := r->>'id';
 insert into mc_runtime_knowledge(kind,source_key,payload,active,synced_at)
 values('FAQ', k,
   jsonb_build_object('product_id',r->>'product_id','category',r->>'category','question',r->>'question','answer',r->>'answer'),
   tg_op<>'DELETE' and coalesce((r->>'active')::boolean,false) and coalesce((r->>'ai_can_use')::boolean,false),now())
 on conflict(kind,source_key)
 do update set payload=excluded.payload,active=excluded.active,synced_at=now();
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger mc_product_faq_knowledge
after insert or update or delete on public.product_faq
for each row execute function public.mc_sync_faq_knowledge();
insert into mc_runtime_knowledge(kind,source_key,payload,active,synced_at)
select 'FAQ', f.id::text,
 jsonb_build_object('product_id',f.product_id,'category',f.category,'question',f.question,'answer',f.answer),
 (f.active and f.ai_can_use),now() from public.product_faq f
on conflict(kind,source_key) do update set payload=excluded.payload,active=excluded.active,synced_at=now();
revoke all on function public.mc_sync_faq_knowledge() from public,anon,authenticated;
grant execute on function public.mc_sync_faq_knowledge() to service_role;
notify pgrst,'reload schema';
commit;