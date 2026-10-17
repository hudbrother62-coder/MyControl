begin;
-- 0/0.00 are unknown prices, never a free-price claim. Preserve sales playbook.
create or replace function public.mc_sync_business_knowledge()
returns trigger language plpgsql security definer set search_path=public as $$
declare r jsonb;k text;s text;p jsonb;
begin
 r:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='products' then
   k:='PRODUCT';s:=r->>'id';
   p:=jsonb_build_object(
      'product_id',s,'product_name',r->>'name',
      'price',case when coalesce((r->>'base_price')::numeric,0)>0 then r->'base_price' else 'null'::jsonb end,
      'promo_price',case when coalesce((r->>'promo_price')::numeric,0)>0 then r->'promo_price' else 'null'::jsonb end,
      'description',r->>'short_description','full_description',r->>'full_description',
      'benefits',r->>'benefits','demo_url',r->>'demo_url',
      'checkout_url',r->>'checkout_url','keywords',r->'keywords',
      'status',r->>'status','sales_guide',mc_sales_guide_payload(s));
 else
   k:='BOT_SETTING';s:=r->>'key';p:=jsonb_build_object('value',r->'value');
 end if;
 insert into mc_runtime_knowledge(kind,source_key,payload,active,synced_at)
 values(k,s,p,tg_op<>'DELETE' and(k<>'PRODUCT' or r->>'status'='ACTIVE'),now())
 on conflict(kind,source_key) do update
   set payload=excluded.payload,active=excluded.active,synced_at=now();
 return case when tg_op='DELETE' then old else new end;
end $$;
update public.products set updated_at=updated_at where coalesce(base_price,0)=0 or coalesce(promo_price,0)=0;
notify pgrst,'reload schema';
commit;