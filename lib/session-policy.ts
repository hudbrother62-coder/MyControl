export type SenderSelection={session:string;sender:string;lid?:string;changedAt?:string;revision?:number};
export type SessionInfo={name:string;status:string;me?:{id?:string;lid?:string;pushName?:string};engine?:unknown;config?:{webhooks?:Array<{url:string;events?:string[]}>}};
export type WorkerInfo={session_name:string;last_seen:string;image_supported?:boolean;settings_revision?:number;worker_contract?:string};
export function sessionReadiness(info:SessionInfo,selected:SenderSelection,worker:WorkerInfo|null,now=Date.now()){
 const identity=info.name===selected.session&&!!selected.sender&&info.me?.id===selected.sender&&(!selected.lid||!info.me?.lid||info.me.lid===selected.lid);
 const seen=worker?new Date(worker.last_seen).getTime():NaN,age=now-seen;
 const heartbeat=!!worker&&worker.session_name===selected.session&&age>=0&&age<90000;
 const synced=(!selected.changedAt||seen>=new Date(selected.changedAt).getTime())&&(selected.revision===undefined||(worker?.settings_revision===selected.revision&&worker?.worker_contract==='session-manager-v1'));
 const ready=info.status==='WORKING'&&identity&&heartbeat&&synced;
 return {identity,heartbeat,synced,ready,image:heartbeat&&worker?.image_supported===true,reason:!identity?'Identitas nomor/LID tidak cocok':info.status!=='WORKING'?'Sesi WhatsApp '+info.status:!heartbeat?'Heartbeat worker tidak tersedia atau lebih dari 90 detik':!synced?'WORKFLOW_UPGRADE_REQUIRED: worker belum mengonfirmasi revisi sesi dinamis; periksa publikasi workflow n8n':null};
}
