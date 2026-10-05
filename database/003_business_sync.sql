-- Existing business tables are retained. Install after 001 + 002.
begin;
create or replace function public.mc_sync_business_knowledge()returns trigger language plpgsql security definer set search_path=public as $$declare r jsonb;k text;s text;p jsonb;begin
 r=case when tg_op='DELETE'then to_jsonb(old)else to_jsonb(new)end;
 if tg_table_name='products'then k='PRODUCT';s=r->>'id';p=jsonb_build_object('product_id',s,'product_name',r->>'name','price',r->'base_price','promo_price',r->'promo_price','description',r->>'short_description','status',r->>'status');else k='BOT_SETTING';s=r->>'key';p=jsonb_build_object('value',r->'value');end if;
 insert into mc_runtime_knowledge(kind,source_key,payload,active,synced_at)values(k,s,p,tg_op<>'DELETE'and(k<>'PRODUCT'or r->>'status'='ACTIVE'),now())on conflict(kind,source_key)do update set payload=excluded.payload,active=excluded.active,synced_at=now();
 return case when tg_op='DELETE'then old else new end;
end$$;
do $$begin
 if to_regclass('public.products')is not null then
  execute 'update mc_runtime_knowledge set active=false where kind=''PRODUCT'' and source_key not in(select id::text from public.products)';
  execute 'drop trigger if exists mc_products_knowledge on public.products';execute 'create trigger mc_products_knowledge after insert or update or delete on public.products for each row execute function public.mc_sync_business_knowledge()';
  execute $q$insert into mc_runtime_knowledge(kind,source_key,payload,active)select 'PRODUCT',p->>'id',jsonb_build_object('product_id',p->>'id','product_name',p->>'name','price',p->'base_price','promo_price',p->'promo_price','description',p->>'short_description','status',p->>'status'),p->>'status'='ACTIVE'from(select to_jsonb(t)p from public.products t)s on conflict(kind,source_key)do update set payload=excluded.payload,active=excluded.active,synced_at=now()$q$;
 end if;
 if to_regclass('public.bot_settings')is not null then
  execute 'drop trigger if exists mc_settings_knowledge on public.bot_settings';execute 'create trigger mc_settings_knowledge after insert or update or delete on public.bot_settings for each row execute function public.mc_sync_business_knowledge()';
  execute $q$insert into mc_runtime_knowledge(kind,source_key,payload,active)select 'BOT_SETTING',p->>'key',jsonb_build_object('value',p->'value'),true from(select to_jsonb(t)p from public.bot_settings t)s on conflict(kind,source_key)do update set payload=excluded.payload,active=true,synced_at=now()$q$;
 end if;
end$$;
revoke all on function public.mc_sync_business_knowledge()from public,anon,authenticated;grant execute on function public.mc_sync_business_knowledge()to service_role;
notify pgrst,'reload schema';commit;
