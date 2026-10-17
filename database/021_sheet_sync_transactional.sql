begin;
create table public.mc_sheet_sync_runs(
 id uuid primary key default gen_random_uuid(),
 sheet_id text not null,
 rows_updated integer not null default 0,
 source text not null default 'GOOGLE_SHEETS_API',
 synced_at timestamptz not null default now()
);
alter table public.mc_sheet_sync_runs enable row level security;
revoke all on public.mc_sheet_sync_runs from public,anon,authenticated;
grant all on public.mc_sheet_sync_runs to service_role;

create function public.mc_apply_product_sheet(p_sheet_id text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 if p_sheet_id !~ '^[A-Za-z0-9_-]{20,100}$' then raise exception 'Sheet id tidak valid';end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then raise exception 'Maksimum 500 baris';end if;
 if exists(
 select 1 from jsonb_array_elements(p_rows) x
 where x->>'product_id' !~ '^[A-Za-z0-9_-]{2,30}$'
    or length(x->>'product_name') not between 2 and 180
    or x->>'status' not in('ACTIVE','DRAFT','INACTIVE')
    or length(coalesce(x->>'full_description',''))>12000
    or length(coalesce(x->>'short_description',''))>3000
    or (nullif(x->>'base_price','') is not null and x->>'base_price' !~ '^[0-9]+(\.[0-9]{1,2})?$')
 ) then raise exception 'Salah satu baris produk tidak valid';end if;
 if exists(select 1 from (select x->>'product_id' id,count(*) n from jsonb_array_elements(p_rows)x group by 1 having count(*)>1)s)
 then raise exception 'Produk duplikat dalam sheet';end if;

 insert into public.products(id,name,status,base_price,cost_hpp,promo_price,
 short_description,full_description,benefits,demo_url,checkout_url,keywords,
 delivery_type,source,updated_at)
 select x->>'product_id',x->>'product_name',x->>'status',
 coalesce(nullif(x->>'base_price','')::numeric,(select base_price from products where id=x->>'product_id'),0),
 coalesce(nullif(x->>'cost_hpp','')::numeric,(select cost_hpp from products where id=x->>'product_id'),0),
 coalesce(nullif(x->>'promo_price','')::numeric,(select promo_price from products where id=x->>'product_id'),0),
 nullif(x->>'short_description',''),nullif(x->>'full_description',''),nullif(x->>'benefits',''),
 nullif(x->>'demo_url',''),nullif(x->>'checkout_url',''),
 string_to_array(coalesce(x->>'keywords',''),','),
 coalesce(nullif(x->>'delivery_type',''),'DIGITAL'),'GOOGLE_SHEETS',now()
 from jsonb_array_elements(p_rows)x
 on conflict(id) do update set name=excluded.name,status=excluded.status,
 base_price=excluded.base_price,cost_hpp=excluded.cost_hpp,promo_price=excluded.promo_price,
 short_description=excluded.short_description,full_description=excluded.full_description,
 benefits=excluded.benefits,demo_url=excluded.demo_url,checkout_url=excluded.checkout_url,
 keywords=excluded.keywords,source='GOOGLE_SHEETS',updated_at=now();

 insert into mc_product_sales_guides(product_id,target_customers,key_benefits,objections,limitations)
 select x->>'product_id',left(coalesce(x->>'target_customer',''),2500),
 left(coalesce(x->>'benefits',''),3500),
 left(coalesce(x->>'objection_handling',''),3500),
 case when x->>'feature_review_status'='PERLU_VERIFIKASI_FITUR'
 then 'Fitur belum terverifikasi; jangan dijanjikan sebagai fitur aktif.'
 else '' end
 from jsonb_array_elements(p_rows) x
 on conflict(product_id)do update set
 target_customers=coalesce(nullif(excluded.target_customers,''),mc_product_sales_guides.target_customers),
 key_benefits=coalesce(nullif(excluded.key_benefits,''),mc_product_sales_guides.key_benefits),
 objections=coalesce(nullif(excluded.objections,''),mc_product_sales_guides.objections),
 limitations=coalesce(nullif(excluded.limitations,''),mc_product_sales_guides.limitations),
 updated_at=now();

 -- One sheet supplies FAQ as newline-delimited question-and-answer entries.
 insert into product_faq(external_id,product_id,category,question,answer,active,ai_can_use)
 select 'SHEET-'||(x->>'product_id')||'-FAQ-'||i::text,
 x->>'product_id','SPREADSHEET',
 left(trim(split_part(line,'?',1))||'?',500),
 left(trim(substr(line,strpos(line,'?')+1)),4000),
 (x->>'status'='ACTIVE'),(x->>'status'='ACTIVE')
 from jsonb_array_elements(p_rows)x
 cross join lateral regexp_split_to_table(coalesce(x->>'faq_qna',''),E'\n')with ordinality as lines(line,i)
 where strpos(line,'?')>0 and length(trim(substr(line,strpos(line,'?')+1)))>=5
 on conflict(external_id) do update set question=excluded.question,answer=excluded.answer,
 active=excluded.active,ai_can_use=excluded.ai_can_use,updated_at=now();

 n:=jsonb_array_length(p_rows);
 insert into mc_sheet_sync_runs(sheet_id,rows_updated)values(p_sheet_id,n);
 return jsonb_build_object('ok',true,'products',n,'sheet_id',p_sheet_id);
end $$;
revoke all on function public.mc_apply_product_sheet(text,jsonb) from public,anon,authenticated;
grant execute on function public.mc_apply_product_sheet(text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;