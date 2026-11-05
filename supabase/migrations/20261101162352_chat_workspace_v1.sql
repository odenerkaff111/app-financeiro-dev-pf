-- Chat workspace only. No financial seed, balance update or deletion of history.
begin;
alter table public.pf_ai_conversations add column if not exists agent text not null default 'registrar' check(agent in ('registrar','consultor'));
alter table public.pf_ai_conversations add column if not exists archived_at timestamptz;
alter table public.pf_ai_messages add column if not exists parts jsonb not null default '{}'::jsonb check(jsonb_typeof(parts)='object');
alter table public.pf_ai_messages add column if not exists client_request_id uuid;
create unique index if not exists pf_chat_message_request_role on public.pf_ai_messages(client_request_id,role) where client_request_id is not null;
create index if not exists pf_chat_owned_history on public.pf_ai_conversations(created_by,household_id,agent,last_message_at desc,id desc);
create index if not exists pf_chat_message_page on public.pf_ai_messages(conversation_id,created_by,created_at desc,id desc);

-- Replace the legacy household-wide chat policies with private conversations.
do $$ declare r record; begin
 for r in select policyname,tablename from pg_policies where schemaname='public' and tablename in ('pf_ai_conversations','pf_ai_messages') loop
 execute format('drop policy %I on public.%I',r.policyname,r.tablename);
 end loop;
end $$;
alter table public.pf_ai_conversations enable row level security;
alter table public.pf_ai_messages enable row level security;
grant select,insert,update,delete on public.pf_ai_conversations,public.pf_ai_messages to authenticated;
revoke all on public.pf_ai_conversations,public.pf_ai_messages from anon;
create policy chat_owned_conversations on public.pf_ai_conversations for all to authenticated
 using(created_by=(select auth.uid()) and public.pf_is_member(household_id))
 with check(created_by=(select auth.uid()) and public.pf_is_member(household_id));
create policy chat_owned_messages on public.pf_ai_messages for all to authenticated
 using(created_by=(select auth.uid()) and public.pf_is_member(household_id) and exists(select 1 from public.pf_ai_conversations c where c.id=conversation_id and c.household_id=pf_ai_messages.household_id and c.created_by=(select auth.uid())))
 with check(created_by=(select auth.uid()) and public.pf_is_member(household_id) and exists(select 1 from public.pf_ai_conversations c where c.id=conversation_id and c.household_id=pf_ai_messages.household_id and c.created_by=(select auth.uid())));

create table if not exists public.pf_chat_requests(
 id uuid primary key,conversation_id uuid not null references public.pf_ai_conversations(id) on delete cascade,
 household_id uuid not null references public.pf_households(id),created_by uuid not null default auth.uid() references auth.users(id),
 status text not null default 'processing' check(status in ('processing','completed','failed','stopped')),
 error_message text,created_at timestamptz not null default now(),finished_at timestamptz
);
create unique index if not exists pf_chat_one_active_turn on public.pf_chat_requests(conversation_id) where status='processing';
create index if not exists pf_chat_requests_owner_idx on public.pf_chat_requests(created_by,household_id,created_at desc);
create table if not exists public.pf_chat_attachments(
 id uuid primary key,conversation_id uuid not null references public.pf_ai_conversations(id) on delete cascade,
 household_id uuid not null references public.pf_households(id),created_by uuid not null default auth.uid() references auth.users(id),
 message_id uuid references public.pf_ai_messages(id) on delete set null,path text not null unique,
 name text not null check(length(name) between 1 and 180),mime text not null,
 size integer not null check(size between 1 and 8388608),sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
 extracted_text text check(length(extracted_text)<=65000),created_at timestamptz not null default now()
);
create index if not exists pf_chat_attachment_conversation_idx on public.pf_chat_attachments(conversation_id,created_by);
create index if not exists pf_chat_attachment_message_idx on public.pf_chat_attachments(message_id);
create table if not exists public.pf_chat_plans(
 id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.pf_ai_conversations(id) on delete cascade,
 household_id uuid not null references public.pf_households(id),created_by uuid not null default auth.uid() references auth.users(id),
 message_id uuid not null references public.pf_ai_messages(id),card_index integer not null check(card_index between 0 and 5),
 title text not null check(length(title) between 1 and 100),card jsonb not null check(jsonb_typeof(card)='object'),
 created_at timestamptz not null default now(),unique(message_id,card_index)
);
create index if not exists pf_chat_plans_owner_idx on public.pf_chat_plans(created_by,household_id,created_at desc);
create index if not exists pf_chat_plans_conversation_idx on public.pf_chat_plans(conversation_id);
do $$ declare name text; begin
 foreach name in array array['pf_chat_requests','pf_chat_attachments','pf_chat_plans'] loop
 execute format('alter table public.%I enable row level security',name);
 execute format('revoke all on public.%I from public,anon',name);
 execute format('grant select,insert,update,delete on public.%I to authenticated',name);
 execute format('grant all on public.%I to service_role',name);
 execute format('drop policy if exists chat_owned on public.%I',name);
 execute format('create policy chat_owned on public.%I for all to authenticated using(created_by=(select auth.uid()) and public.pf_is_member(household_id) and exists(select 1 from public.pf_ai_conversations c where c.id=conversation_id and c.household_id=%I.household_id and c.created_by=(select auth.uid()))) with check(created_by=(select auth.uid()) and public.pf_is_member(household_id) and exists(select 1 from public.pf_ai_conversations c where c.id=conversation_id and c.household_id=%I.household_id and c.created_by=(select auth.uid())))',name,name,name);
 end loop;
end $$;

create or replace function public.pf_chat_claim_turn(p_conversation uuid,p_request uuid,p_content text,p_attachments jsonb default '[]'::jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.pf_ai_conversations%rowtype;r public.pf_chat_requests%rowtype;a jsonb;n integer;
begin
 select * into c from public.pf_ai_conversations where id=p_conversation and created_by=auth.uid() and public.pf_is_member(household_id) for update;
 if not found or c.archived_at is not null then raise exception 'Conversa indisponivel.';end if;
 select * into r from public.pf_chat_requests where id=p_request and conversation_id=c.id and created_by=auth.uid();
 if found then return to_jsonb(r)||jsonb_build_object('replayed',true);end if;
 if length(p_content)>14000 or (length(trim(p_content))=0 and jsonb_array_length(p_attachments)=0) then raise exception 'Mensagem invalida.';end if;
 if jsonb_typeof(p_attachments)<>'array' or jsonb_array_length(p_attachments)>5 then raise exception 'Anexos invalidos.';end if;
 update public.pf_chat_requests set status='failed',error_message='A resposta anterior excedeu o tempo de processamento.',finished_at=now() where conversation_id=c.id and status='processing' and created_at<now()-interval '120 seconds';
 if exists(select 1 from public.pf_chat_requests where conversation_id=c.id and status='processing') then raise exception 'Ja existe uma resposta em andamento nesta conversa.';end if;
 select count(*) into n from public.pf_chat_requests where created_by=auth.uid() and created_at>now()-interval '1 hour';
 if n>=40 then raise exception 'Limite de 40 mensagens por hora atingido.';end if;
 for a in select value from jsonb_array_elements(p_attachments) loop
 if not exists(select 1 from public.pf_chat_attachments where id=(a->>'id')::uuid and conversation_id=c.id and created_by=auth.uid()) then raise exception 'Anexo nao autorizado.';end if;
 end loop;
 insert into public.pf_chat_requests(id,conversation_id,household_id,created_by) values(p_request,c.id,c.household_id,auth.uid()) returning * into r;
 insert into public.pf_ai_messages(id,conversation_id,household_id,created_by,role,content,parts,client_request_id)
 values(p_request,c.id,c.household_id,auth.uid(),'user',p_content,jsonb_build_object('attachments',p_attachments,'requestId',p_request),p_request);
 for a in select value from jsonb_array_elements(p_attachments) loop update public.pf_chat_attachments set message_id=p_request where id=(a->>'id')::uuid and created_by=auth.uid() and message_id is null;end loop;
 update public.pf_ai_conversations set last_message_at=now(),updated_at=now(),title=case when title in ('Nova conversa','Assistente financeiro') then left(regexp_replace(coalesce(nullif(trim(p_content),''),'Análise de comprovante'),'\s+',' ','g'),70) else title end where id=c.id;
 return to_jsonb(r);
end $$;

create or replace function public.pf_chat_finish_turn(p_request uuid,p_content text,p_parts jsonb default '{}'::jsonb,p_payload jsonb default '{}'::jsonb,p_action text default null,p_error text default null) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.pf_chat_requests%rowtype;c public.pf_ai_conversations%rowtype;m public.pf_ai_messages%rowtype;
begin
 select * into r from public.pf_chat_requests where id=p_request and created_by=auth.uid() for update;
 if not found then raise exception 'Pedido nao autorizado.';end if;
 select * into c from public.pf_ai_conversations where id=r.conversation_id and created_by=auth.uid();
 if not found then raise exception 'Conversa nao autorizada.';end if;
 if r.status<>'processing' then select * into m from public.pf_ai_messages where client_request_id=r.id and role='assistant';return to_jsonb(m);end if;
 if c.agent='consultor' and coalesce(p_action,'none')<>'none' then raise exception 'Consultor nao pode preparar escrita financeira.';end if;
 if length(p_content)>60000 or length(p_parts::text)>200000 or jsonb_typeof(p_parts)<>'object' then raise exception 'Resposta invalida.';end if;
 if p_action is not null and p_action not in ('none','batch_update') then raise exception 'Acao invalida.';end if;
 insert into public.pf_ai_messages(conversation_id,household_id,created_by,role,content,parts,action_type,action_payload,action_status,error_message,client_request_id)
 values(r.conversation_id,r.household_id,auth.uid(),'assistant',p_content,p_parts,nullif(p_action,'none'),p_payload,case when p_action='batch_update' then 'pending' else 'none' end,p_error,r.id) returning * into m;
 update public.pf_chat_requests set status=case when p_error is not null then 'failed' when coalesce((p_parts->>'stopped')::boolean,false) then 'stopped' else 'completed' end,error_message=p_error,finished_at=now() where id=r.id;
 update public.pf_ai_conversations set last_message_at=now(),updated_at=now() where id=r.conversation_id;
 return to_jsonb(m);
end $$;
create or replace function public.pf_chat_usage_total(p_household uuid) returns numeric language sql security invoker stable set search_path=public,pg_temp as $$
 select coalesce(sum(cost_usd),0) from public.pf_ai_usage where household_id=p_household and public.pf_is_member(p_household) and created_at>=date_trunc('month',now());
$$;
revoke all on function public.pf_chat_claim_turn(uuid,uuid,text,jsonb),public.pf_chat_finish_turn(uuid,text,jsonb,jsonb,text,text),public.pf_chat_usage_total(uuid) from public,anon;
grant execute on function public.pf_chat_claim_turn(uuid,uuid,text,jsonb),public.pf_chat_finish_turn(uuid,text,jsonb,jsonb,text,text),public.pf_chat_usage_total(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('kyra-chat-private','kyra-chat-private',false,8388608,array['image/jpeg','image/png','image/webp','application/pdf','text/csv','application/x-ofx','application/octet-stream','text/plain']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists kyra_chat_upload on storage.objects;
create policy kyra_chat_upload on storage.objects for insert to authenticated with check(bucket_id='kyra-chat-private' and (storage.foldername(name))[2]=(select auth.uid())::text and exists(select 1 from public.pf_household_members m where m.household_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid())));
drop policy if exists kyra_chat_read on storage.objects;
create policy kyra_chat_read on storage.objects for select to authenticated using(bucket_id='kyra-chat-private' and (storage.foldername(name))[2]=(select auth.uid())::text and exists(select 1 from public.pf_household_members m where m.household_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid())));
drop policy if exists kyra_chat_delete on storage.objects;
create policy kyra_chat_delete on storage.objects for delete to authenticated using(bucket_id='kyra-chat-private' and (storage.foldername(name))[2]=(select auth.uid())::text and exists(select 1 from public.pf_household_members m where m.household_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid())));
commit;
