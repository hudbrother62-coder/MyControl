begin;
create or replace function public.mc_ack_product_sheet(p_id text,p_row jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 delete from public.mc_product_sheet_pending where product_id=p_id and row_data=p_row;
 get diagnostics n=row_count;
 if n>0 then
   update public.products set source='GOOGLE_SHEETS'
   where id=p_id;
 end if;
 return jsonb_build_object('ok',n>0,'pending',n=0);
end $$;
revoke all on function public.mc_ack_product_sheet(text,jsonb) from public,anon,authenticated;
grant execute on function public.mc_ack_product_sheet(text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;