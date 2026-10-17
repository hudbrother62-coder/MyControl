begin;
-- Owner-authored sales knowledge, separate from customer memory, never mix internal costs.
create table public.mc_product_sales_guides(
 product_id text primary key references public.products(id) on delete cascade,
 target_customers text not null default '' check(length(target_customers)<=2500),
 customer_problems text not null default '' check(length(customer_problems)<=3500),
 key_benefits text not null default '' check(length(key_benefits)<=3500),
 verified_features text not null default '' check(length(verified_features)<=3500),
 differentiators text not null default '' check(length(differentiators)<=2500),
 use_cases text not null default '' check(length(use_cases)<=3500),
 objections text not null default '' check(length(objections)<=3500),
 proof_points text not null default '' check(length(proof_points)<=2500),
 limitations text not null default '' check(length(limitations)<=2500),
 next_step text not null default '' check(length(next_step)<=1800),
 updated_at timestamptz not null default now()
);
alter table public.mc_product_sales_guides enable row level security;
revoke all on table public.mc_product_sales_guides from public,anon,authenticated;
grant all on table public.mc_product_sales_guides to service_role;

create or replace function public.mc_sales_guide_payload(p_product_id text)
returns jsonb language sql stable security definer set search_path=public as $$
select coalesce((
select jsonb_build_object(
 'target_customers',nullif(trim(target_customers),''),
 'customer_problems',nullif(trim(customer_problems),''),
 'key_benefits',nullif(trim(key_benefits),''),
 'verified_features',nullif(trim(verified_features),''),
 'differentiators',nullif(trim(differentiators),''),
 'use_cases',nullif(trim(use_cases),''),
 'objections',nullif(trim(objections),''),
 'proof_points',nullif(trim(proof_points),''),
 'limitations',nullif(trim(limitations),''),
 'next_step',nullif(trim(next_step),''),
 'source','OWNER_APPROVED_SALES_GUIDE')
from mc_product_sales_guides where product_id=p_product_id
),'{}'::jsonb)
$$;

-- Preserve guide when the original Products editor later updates a product.
create or replace function public.mc_sync_business_knowledge()
returns trigger language plpgsql security definer set search_path=public as $$
declare r jsonb;k text;s text;p jsonb;
begin
 r:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='products' then
   k:='PRODUCT';s:=r->>'id';
   p:=jsonb_build_object(
      'product_id',s,'product_name',r->>'name',
      'price',nullif(r->>'base_price','0'),'promo_price',nullif(r->>'promo_price','0'),
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
end$$;

create function public.mc_sync_sales_guide_knowledge()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_id text;p jsonb;
begin
 v_id:=case when tg_op='DELETE' then old.product_id else new.product_id end;
 update public.mc_runtime_knowledge k
   set payload=jsonb_set(k.payload,'{sales_guide}',mc_sales_guide_payload(v_id),true),
       synced_at=now()
   where k.kind='PRODUCT' and k.source_key=v_id;
 return case when tg_op='DELETE' then old else new end;
end$$;
create trigger mc_sales_guide_knowledge_trigger
after insert or update or delete on public.mc_product_sales_guides
for each row execute function public.mc_sync_sales_guide_knowledge();

-- Promotional offers are distinct from verified product knowledge and can expire.
create or replace function public.mc_sync_promotion_knowledge()
returns trigger language plpgsql security definer set search_path=public as $$
declare r jsonb;
begin
 r:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 insert into mc_runtime_knowledge(kind,source_key,payload,active,synced_at)
 values('PROMOTION',r->>'id',
 jsonb_build_object('product_id',r->>'product_id','promo_name',r->>'name',
   'discount_type',r->>'discount_type','discount_value',r->'discount_value',
   'start_at',r->'start_at','end_at',r->'end_at','notes',r->>'notes'),
 tg_op<>'DELETE' and coalesce((r->>'active')::boolean,false),now())
 on conflict(kind,source_key) do update set payload=excluded.payload,active=excluded.active,synced_at=now();
 return case when tg_op='DELETE' then old else new end;
end$$;
create trigger mc_promotion_knowledge_trigger
after insert or update or delete on public.promotions
for each row execute function public.mc_sync_promotion_knowledge();

-- Filter expired/not-yet-valid promotions from the model's official context.
create or replace function public.mc_get_ai_context(p_chat_id text,p_history_limit integer default 30)
returns jsonb language sql stable security definer set search_path=public as $$
select mc_get_ai_context_base(p_chat_id,p_history_limit)
||jsonb_build_object(
 'knowledge',coalesce((
   select jsonb_agg(jsonb_build_object('kind',k.kind,'source_key',k.source_key,'payload',k.payload))
   from mc_runtime_knowledge k where k.active=true
   and (k.kind<>'PROMOTION' or
      (coalesce((k.payload->>'start_at')::timestamptz,'-infinity'::timestamptz)<=now()
      and coalesce((k.payload->>'end_at')::timestamptz,'infinity'::timestamptz)>=now()))
 ),'[]'::jsonb),
 'campaigns',coalesce((
    select jsonb_agg(x) from (
      select c.id,c.name,c.product_id,c.steps,c.bot_enabled,cr.replied_at,'inferred' as attribution
      from mc_campaign_recipients cr join mc_campaigns c on c.id=cr.campaign_id
      where cr.phone=split_part(p_chat_id,'@',1)
      and exists(select 1 from mc_outbound_jobs o
        where o.recipient_id=cr.id and o.status in('SENT','UNKNOWN','PROCESSING'))
      order by c.created_at desc limit 3
    )x
 ),'[]'::jsonb),
 'memory',coalesce((select to_jsonb(m) from mc_contact_memories m where m.chat_id=p_chat_id),'{}'::jsonb),
 'opportunities',coalesce((select jsonb_agg(o) from mc_opportunities o where o.chat_id=p_chat_id),'[]'::jsonb),
 'promotional_opt_out',coalesce((select opted_out_at is not null from mc_campaign_contacts where phone=split_part(p_chat_id,'@',1)),false)
)$$;

-- Existing product context immediately receives a safe, grounded seed guide.
insert into public.mc_product_sales_guides(product_id,target_customers,customer_problems,key_benefits,use_cases,limitations,next_step)
select id,
 case id when 'KP001' then 'Kepala sekolah, wakil kepala sekolah, tim manajemen pendidikan'
 when 'BK001' then 'Guru, wali kelas, dan pengelola administrasi pembelajaran'
 when 'GP001' then 'Pemilik usaha, HR, admin personalia, petugas penggajian' end,
 case id when 'KP001' then 'Dokumen perencanaan sekolah dan supervisi membutuhkan penataan serta pemeriksaan.'
 when 'BK001' then 'Data pembelajaran, presensi, nilai, dan laporan sering tersebar.'
 when 'GP001' then 'Administrasi kehadiran dan penggajian karyawan perlu alur lebih tertata.' end,
 case id when 'KP001' then 'Membantu menyusun dan menata bahan kerja kepala sekolah secara sistematis.'
 when 'BK001' then 'Membantu guru mengelola pekerjaan administratif pembelajaran dalam satu alur.'
 when 'GP001' then 'Membantu HR/owner mengorganisasikan informasi kehadiran dan proses penggajian.' end,
 case id when 'KP001' then 'Diskusi kebutuhan perencanaan, supervisi, dan administrasi sekolah.'
 when 'BK001' then 'Diskusi kebutuhan pengelolaan data kelas, presensi, nilai, dan agenda.'
 when 'GP001' then 'Diskusi kebutuhan kehadiran staf, rekap, dan proses gaji.' end,
 'Daftar ini adalah konteks kebutuhan dan manfaat, bukan konfirmasi seluruh modul telah aktif. Hindari menjanjikan fitur, integrasi, hasil, atau harga tanpa bukti versi produk.',
 'Jawab kebutuhan pelanggan dahulu, lalu tanyakan maksimal satu pertanyaan relevan atau tawarkan langkah resmi yang tersedia.'
 from public.products where id in('KP001','BK001','GP001')
 on conflict(product_id) do nothing;
update products set updated_at=updated_at where id in('KP001','BK001','GP001');

revoke all on function public.mc_sales_guide_payload(text), public.mc_sync_sales_guide_knowledge(),
 public.mc_sync_promotion_knowledge() from public,anon,authenticated;
grant execute on function public.mc_sales_guide_payload(text),
 public.mc_sync_sales_guide_knowledge(),public.mc_sync_promotion_knowledge() to service_role;
notify pgrst,'reload schema';
commit;