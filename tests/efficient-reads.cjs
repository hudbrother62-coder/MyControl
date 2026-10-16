const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),test=require('node:test'),assert=require('node:assert/strict');
let db;
test.before(async()=>{
 db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');
 for(const f of ['001_queue','002_reliability','003_business_sync','005_campaigns'])await db.exec(fs.readFileSync('database/'+f+'.sql','utf8').replace('create extension if not exists pgcrypto;',''));
 await db.exec(`create table orders(id uuid default gen_random_uuid(),product_name text,total numeric,cost_hpp numeric,status text,created_at timestamptz default now());create table leads(id uuid,status text);create table messages(id uuid,conversation_id uuid,created_at timestamptz);create table payment_verifications(id uuid,status text,created_at timestamptz);`);
 await db.exec(fs.readFileSync('database/007_efficient_reads.sql','utf8'));
});
test.after(async()=>{await db?.close()});
test('summary covers full dataset rather than visible 50 rows',async()=>{
 await db.exec(`insert into orders(product_name,total,cost_hpp,status)select 'Produk',100,20,'PAID'from generate_series(1,121);insert into orders(product_name,total,status)values('Unpaid',999,'PENDING');`);
 const {rows}=await db.query('select mc_dashboard_summary() as s');assert.equal(rows[0].s.revenue,12100);assert.equal(rows[0].s.profit,9680);assert.equal(rows[0].s.closing,121);assert.equal(rows[0].s.by_product[0].qty,121);
});
test('chat pages handle timestamp ties and do not leak another contact',async()=>{
 await db.exec(`insert into mc_inbound_events(external_message_id,chat_id,message_text,received_at)select 'page-'||i,'628111111111@c.us','message-'||i,'2026-01-01'::timestamptz from generate_series(1,101)i;insert into mc_inbound_events(external_message_id,chat_id,message_text)values('other','628222222222@c.us','private');`);
 let before=null,id=null,seen=[];
 for(let n=0;n<3;n++){const {rows}=await db.query('select mc_chat_page($1,$2,$3) as p',['628111111111@c.us',before,id]);const p=rows[0].p;assert.equal(p.messages.length,n===2?1:50);assert.equal(p.hasMore,n<2);seen.push(...p.messages.map(m=>m.id));before=p.messages[0].createdAt;id=p.messages[0].id;assert.ok(p.messages.every(m=>m.text!=='private'))}
 assert.equal(new Set(seen).size,101);
});
test('report functions cannot be called by anonymous users',async()=>{const {rows}=await db.query("select has_function_privilege('anon','mc_dashboard_summary()','execute') as allowed");assert.equal(rows[0].allowed,false)});
