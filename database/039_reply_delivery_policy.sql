begin;
-- Fix false positive: explaining a future verification is not confirming payment.
create or replace function public.mc_prime_store_outbound_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare c jsonb; u text; normalized text; payment_text text;
begin
 if new.kind not in ('AI_REPLY','FOLLOW_UP','CAMPAIGN') or new.status not in ('PENDING','RETRY','PROCESSING') then return new;end if;
 normalized:=lower(regexp_replace(translate(new.body,chr(8203)||chr(8204)||chr(8205)||chr(65279),''),'[*_`~]','','g'));
 if normalized ~ '(chat[.]whatsapp[.]com|wa[.]me/|whatsapp[.]com/(invite|channel)|releases/download|[.]apk([?#/[:space:]]|$)|fctv[0-9]*hd[.]|kode[[:space:]]+(lisensi|aktivasi)[[:space:]]*[:=]|password[[:space:]]*[:=])'
 or (new.kind in ('AI_REPLY','FOLLOW_UP') and coalesce(to_jsonb(new)->>'media_url','')<>'') then
  new.status:='CANCELLED';new.last_error:='PRIME_STORE_MANUAL_ACCESS_ONLY';return new;
 end if;
 for u in select (regexp_matches(normalized,'https?://[^[:space:]<>]+','g'))[1] loop
  u:=rtrim(u,'.!,;:)');
  if u not in ('https://sekolapro.com','https://sekolapro.com/','https://youtu.be/hzwfpvg8tui','https://youtu.be/9zbwxkzj6b4') then
   new.status:='CANCELLED';new.last_error:='PRIME_STORE_UNAPPROVED_AUTO_URL';return new;
  end if;
 end loop;
 if normalized ~ '(berikut|ini|saya kirim|kami kirim).{0,30}(link akses|kode aktivasi|kode lisensi|akun dan password)' then
  new.status:='CANCELLED';new.last_error:='PRIME_STORE_MANUAL_ACCESS_ONLY';return new;
 end if;
 payment_text:=regexp_replace(normalized,'(bukti|screenshot|tangkapan layar)[^.?!\\n]{0,60}(terima|diterima)[^.?!\\n]{0,50}(periksa|verifikasi|cek)','','g');
 -- Strip only the conditional phrase, never the remainder or a later claim.
 payment_text:=regexp_replace(payment_text,'(setelah|sesudah|jika|apabila|kalau|bila)[[:space:]]+pembayaran(nya)?[[:space:]]+(berhasil[[:space:]]+)?terverifikasi','setelah pemeriksaan admin','g');
 payment_text:=regexp_replace(payment_text,'(belum|belom)[[:space:]]+(berhasil|terverifikasi|lunas|diterima|aktif)','menunggu','g');
 if payment_text ~ '(pembayaran(nya)?[[:space:]]+(sudah[[:space:]]+)?(berhasil|terverifikasi|lunas|diterima)|pesanan(nya)?[[:space:]]+(sudah[[:space:]]+)?lunas|transfer(nya)?[[:space:]]+(sudah[[:space:]]+)?(masuk|diterima)|uang(nya)?[[:space:]]+(sudah[[:space:]]+)?(masuk|diterima)|akun(nya)?[[:space:]]+(sudah[[:space:]]+)?aktif)' then
  c:=public.mc_get_ai_context(new.chat_id,1);
  if not coalesce((c->'prime_store'->>'payment_verified')::boolean,false) then
   new.status:='CANCELLED';new.last_error:='PRIME_STORE_PAYMENT_NOT_VERIFIED';
  end if;
 end if;
 return new;
end$$;

revoke all on function public.mc_prime_store_outbound_guard() from public,anon,authenticated;
grant execute on function public.mc_prime_store_outbound_guard() to service_role;
-- Remove obsolete checkout URLs from tool-visible runtime knowledge as well.
update public.mc_runtime_knowledge set payload=replace(replace(payload::text,'https://profit-meledak.store/sekolapro-1bulan','https://sekolapro.com'),'https://profit-meledak.store/sekolapro-selamanya','https://sekolapro.com')::jsonb
where active and payload::text like '%profit-meledak.store/sekolapro-%';
notify pgrst,'reload schema';
commit;
