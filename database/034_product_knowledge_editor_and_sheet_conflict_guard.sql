begin;
create table if not exists public.mc_product_sheet_pending (
 product_id text primary key references public.products(id) on delete cascade,
 sheet_id text not null,
 row_data jsonb not null,
 changed_at timestamptz not null default now()
);
alter table public.mc_product_sheet_pending enable row level security;
revoke all on public.mc_product_sheet_pending from public,anon,authenticated;
grant all on public.mc_product_sheet_pending to service_role;

create or replace function public.mc_save_product_knowledge(p_row jsonb,p_sheet_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id text;v_status text;v_faq text;v_line text;v_count integer:=0;v_idx integer:=0;
begin
 if jsonb_typeof(p_row) is distinct from 'object' then raise exception 'Data produk tidak valid';end if;
 v_id:=trim(coalesce(p_row->>'product_id',''));
 v_status:=upper(trim(coalesce(p_row->>'status','DRAFT')));
 if v_id !~ '^[A-Za-z0-9_-]{2,30}$' or length(trim(coalesce(p_row->>'product_name',''))) not between 2 and 180
 or v_status not in('ACTIVE','DRAFT','INACTIVE') then raise exception 'ID, nama atau status produk tidak valid';end if;
 if p_sheet_id !~ '^[A-Za-z0-9_-]{20,100}$' then raise exception 'Google Sheet ID tidak valid';end if;
 if length(coalesce(p_row->>'short_description',''))>3000 or length(coalesce(p_row->>'full_description',''))>12000
 or length(coalesce(p_row->>'benefits',''))>5000 or length(coalesce(p_row->>'faq_qna',''))>9000
 or length(coalesce(p_row->>'objection_handling',''))>3500 then raise exception 'Isi pengetahuan terlalu panjang';end if;
 if exists (select 1 from jsonb_each_text(p_row) t
 where t.key in('base_price','cost_hpp','promo_price')
 and t.value<>'' and t.value !~ '^[0-9]+([.][0-9]{1,2})?$') then raise exception 'Harga harus berupa angka nonnegatif';end if;
 if exists (select 1 from jsonb_each_text(p_row) t
 where t.key in('demo_url','checkout_url') and t.value<>''
 and t.value !~ '^https://[^ ]+$') then raise exception 'Tautan harus HTTPS';end if;

 insert into public.products(id,name,status,base_price,cost_hpp,promo_price,
 short_description,full_description,benefits,demo_url,checkout_url,keywords,
 delivery_type,source,updated_at)
 values (v_id,trim(p_row->>'product_name'),v_status,
 coalesce(nullif(p_row->>'base_price','')::numeric,0),
 coalesce(nullif(p_row->>'cost_hpp','')::numeric,0),
 coalesce(nullif(p_row->>'promo_price','')::numeric,0),
 nullif(p_row->>'short_description',''),nullif(p_row->>'full_description',''),
 nullif(p_row->>'benefits',''),nullif(p_row->>'demo_url',''),nullif(p_row->>'checkout_url',''),
 string_to_array(coalesce(p_row->>'keywords',''),','),
 coalesce(nullif(p_row->>'delivery_type',''),'DIGITAL'),'WEB',now())
 on conflict(id)do update set name=excluded.name,status=excluded.status,
 base_price=excluded.base_price,cost_hpp=excluded.cost_hpp,promo_price=excluded.promo_price,
 short_description=excluded.short_description,full_description=excluded.full_description,
 benefits=excluded.benefits,demo_url=excluded.demo_url,checkout_url=excluded.checkout_url,
 keywords=excluded.keywords,delivery_type=excluded.delivery_type,source='WEB',updated_at=now();

 insert into public.mc_product_sales_guides(product_id,target_customers,key_benefits,objections,limitations)
 values(v_id,left(coalesce(p_row->>'target_customer',''),2500),
 left(coalesce(p_row->>'benefits',''),3500),
 left(coalesce(p_row->>'objection_handling',''),3500),
 case when p_row->>'feature_review_status'='PERLU_VERIFIKASI_FITUR'
 then 'Fitur belum terverifikasi; jangan dijanjikan sebagai fitur aktif.'
 else '' end)
 on conflict(product_id)do update set
 target_customers=excluded.target_customers,key_benefits=excluded.key_benefits,
 objections=excluded.objections,limitations=excluded.limitations,updated_at=now();

 -- Reuse the spreadsheet FAQ IDs, so the sheet and web never create parallel entries.
 v_faq:=coalesce(p_row->>'faq_qna','');
 for v_line in select trim(line) from regexp_split_to_table(v_faq,E'\n') line loop
   if strpos(v_line,'?')=0 or length(trim(substr(v_line,strpos(v_line,'?')+1)))<3 then continue;end if;
   v_idx:=v_idx+1;
   insert into public.product_faq(external_id,product_id,category,question,answer,active,ai_can_use)
   values('SHEET-'||v_id||'-FAQ-'||v_idx,v_id,'SPREADSHEET',
   left(trim(split_part(v_line,'?',1))||'?',500),
   left(trim(substr(v_line,strpos(v_line,'?')+1)),4000),v_status='ACTIVE',v_status='ACTIVE')
   on conflict(external_id)do update set question=excluded.question,answer=excluded.answer,
     active=excluded.active,ai_can_use=excluded.ai_can_use,updated_at=now();
   v_count:=v_count+1;
 end loop;
 update public.product_faq set active=false,ai_can_use=false,updated_at=now()
 where product_id=v_id and external_id like 'SHEET-'||v_id||'-FAQ-%'
 and substring(external_id from 'FAQ-([0-9]+)$')::int>v_idx;

 insert into public.mc_product_sheet_pending(product_id,sheet_id,row_data,changed_at)
 values(v_id,p_sheet_id,p_row,now())
 on conflict(product_id) do update set sheet_id=excluded.sheet_id,row_data=excluded.row_data,changed_at=now();

 return jsonb_build_object('ok',true,'product_id',v_id,'faq_saved',v_count,'sheet_sync_pending',true);
end;$$;

create or replace function public.mc_product_knowledge_detail(p_id text)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
 'product_id',p.id,'product_name',p.name,'status',p.status,
 'base_price',case when p.base_price>0 then p.base_price::text else '' end,
 'cost_hpp',case when p.cost_hpp>0 then p.cost_hpp::text else '' end,
 'promo_price',case when p.promo_price>0 then p.promo_price::text else '' end,
 'short_description',coalesce(p.short_description,''),
 'full_description',coalesce(p.full_description,''),
 'benefits',coalesce(p.benefits,''),
 'demo_url',coalesce(p.demo_url,''),
 'checkout_url',coalesce(p.checkout_url,''),
 'keywords',coalesce(array_to_string(p.keywords,','),''),
 'delivery_type',coalesce(p.delivery_type,'DIGITAL'),
 'target_customer',coalesce(g.target_customers,''),
 'objection_handling',coalesce(g.objections,''),
 'feature_review_status',case when coalesce(g.limitations,'') ilike '%belum terverifikasi%' then 'PERLU_VERIFIKASI_FITUR' else 'TERVERIFIKASI' end,
 'faq_qna',coalesce((select string_agg(trim(f.question)||' '||trim(f.answer),E'\n' order by f.external_id)
 from public.product_faq f where f.product_id=p.id and f.external_id like 'SHEET-'||p.id||'-FAQ-%'
 and f.active=(p.status='ACTIVE')),''),
 'sheet_sync_pending',exists(select 1 from public.mc_product_sheet_pending pend where pend.product_id=p.id)
 )
 from public.products p left join public.mc_product_sales_guides g on g.product_id=p.id
 where p.id=p_id
$$;
revoke all on function public.mc_save_product_knowledge(jsonb,text) from public,anon,authenticated;
revoke all on function public.mc_product_knowledge_detail(text) from public,anon,authenticated;
grant execute on function public.mc_save_product_knowledge(jsonb,text) to service_role;
grant execute on function public.mc_product_knowledge_detail(text) to service_role;

-- Avoid data loss: a scheduled Sheets pull must not silently overwrite a web edit.
alter function public.mc_apply_product_sheet(text,jsonb)
 rename to mc_apply_product_sheet_before_web_pending;
create function public.mc_apply_product_sheet(p_sheet_id text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.mc_product_sheet_pending
           where sheet_id=p_sheet_id) then
  raise exception 'Ada perubahan produk dari web yang belum masuk Google Sheets. Sinkronisasi masuk ditahan supaya perubahan web tidak tertimpa.';
 end if;
 return public.mc_apply_product_sheet_before_web_pending(p_sheet_id,p_rows);
end;$$;
revoke all on function public.mc_apply_product_sheet(text,jsonb) from public,anon,authenticated;
grant execute on function public.mc_apply_product_sheet(text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;