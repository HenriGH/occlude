-- Apply once after the two 20261017 migrations. Existing image cards/history stay intact.
begin;

alter table public.cards alter column region_id drop not null;
alter table public.cards alter column image_id drop not null;
alter table public.cards add column kind text not null default 'occlusion';
alter table public.cards add column deck_id uuid;
alter table public.cards add column front text;
alter table public.cards add column back text;
alter table public.cards add constraint cards_basic_deck_fk foreign key(deck_id,user_id) references public.decks(id,user_id);
alter table public.cards add constraint cards_kind_shape check (
  (kind='occlusion' and region_id is not null and image_id is not null and deck_id is null and front is null and back is null)
  or (kind='basic' and region_id is null and image_id is null and deck_id is not null
    and length(btrim(front,E' \t\n\r')) between 1 and 10000 and length(btrim(back,E' \t\n\r')) between 1 and 10000 and front is not null and back is not null)
);
create index cards_basic_deck on public.cards(user_id,deck_id) where kind='basic';

-- Supabase OAuth identity scopes do not restrict database access. Enforce the
-- separate, explicitly approved capability here, including calls bypassing MCP.
create function public.occlude_oauth_client_id() returns uuid language sql stable set search_path=pg_catalog as $$
  select nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'client_id','')::uuid
$$;
create function public.occlude_direct_session() returns boolean language sql stable set search_path=pg_catalog,public as $$
  select public.occlude_oauth_client_id() is null
$$;
revoke all on function public.occlude_oauth_client_id(),public.occlude_direct_session() from public,anon;
grant execute on function public.occlude_oauth_client_id(),public.occlude_direct_session() to authenticated;

do $$ declare t text; begin
  foreach t in array array['profiles','decks','images','occlusion_regions','cards','review_events','sync_operations'] loop
    execute format('create policy direct_sessions_only on public.%I as restrictive for all to authenticated using ((select public.occlude_direct_session())) with check ((select public.occlude_direct_session()))',t);
  end loop;
end $$;
create policy occlude_direct_storage_only on storage.objects as restrictive for all to authenticated
using (bucket_id<>'occlude-images' or (select public.occlude_direct_session()))
with check (bucket_id<>'occlude-images' or (select public.occlude_direct_session()));

-- Keep original RPC implementation private. Old clients receive image-only
-- snapshots; new clients opt into the mixed-card snapshot explicitly.
alter function public.occlude_snapshot() rename to occlude_snapshot_v1;
revoke all on function public.occlude_snapshot_v1() from public,anon,authenticated;
create function public.occlude_snapshot() returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb; begin
  if not public.occlude_direct_session() then raise exception 'direct user session required' using errcode='42501'; end if;
  result:=public.occlude_snapshot_v1();
  return result || jsonb_build_object(
    'cards',coalesce((select jsonb_agg(t) from jsonb_array_elements(result->'cards') t where t->>'kind'='occlusion'),'[]'),
    'reviews',coalesce((select jsonb_agg(t) from jsonb_array_elements(result->'reviews') t where exists(
      select 1 from public.cards c where c.id=(t->>'card_id')::uuid and c.user_id=auth.uid() and c.kind='occlusion')),'[]')
  );
end $$;
create function public.occlude_snapshot_v2() returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not public.occlude_direct_session() then raise exception 'direct user session required' using errcode='42501'; end if;
  return public.occlude_snapshot_v1() || jsonb_build_object('features',jsonb_build_array('region-labels','basic-cards'));
end $$;

alter function public.occlude_apply_operation(jsonb) rename to occlude_apply_operation_v1;
revoke all on function public.occlude_apply_operation_v1(jsonb) from public,anon,authenticated;
create function public.occlude_apply_operation(p_operation jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  u uuid:=auth.uid(); operation_kind text:=p_operation->>'kind'; op uuid:=(p_operation->>'id')::uuid;
  target uuid; device uuid; base bigint; p jsonb:=p_operation->'payload'; previous public.sync_operations;
  card public.cards; v bigint; result jsonb; affected uuid[];
begin
  if u is null or not public.occlude_direct_session() then raise exception 'direct user session required' using errcode='42501'; end if;
  if operation_kind not in ('basic.put','basic.delete') then
    if operation_kind='image.put' and jsonb_typeof(p->'cards')='array' then
      if exists(select 1 from public.cards c join jsonb_array_elements(p->'cards') item on c.id=(item->>'id')::uuid where c.user_id=u and c.kind='basic') then raise exception 'card kind is immutable' using errcode='22023'; end if;
    end if;
    result:=public.occlude_apply_operation_v1(p_operation);
    if operation_kind='deck.delete' then
      with recursive subtree as (
        select id from public.decks where id=(p_operation->>'entityId')::uuid and user_id=u
        union select d.id from public.decks d join subtree s on d.parent_id=s.id where d.user_id=u
      ) select array_agg(id) into affected from subtree;
      update public.cards set deleted_at=now(),updated_at=now(),version=version+1
        where user_id=u and kind='basic' and deck_id=any(affected) and deleted_at is null;
    end if;
    return result;
  end if;
  target:=(p_operation->>'entityId')::uuid; device:=(p_operation->>'deviceId')::uuid; base:=(p_operation->>'baseVersion')::bigint;
  if op is null or target is null or device is null or base is null or base<0 or jsonb_typeof(p) is distinct from 'object'
    or jsonb_path_exists(p_operation,'$.**.user_id') or jsonb_path_exists(p_operation,'$.**.userId')
  then raise exception 'invalid operation or forged ownership' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  select * into previous from public.sync_operations where id=op and user_id=u;
  if found then
    if previous.operation_payload<>p_operation then raise exception 'operation ID reused with different payload' using errcode='22023'; end if;
    return previous.result;
  end if;
  select * into card from public.cards where id=target and user_id=u;
  if coalesce(card.version,0)<>base or card.deleted_at is not null then raise exception 'conflict:basic:%',target; end if;
  if card.id is not null and card.kind<>'basic' then raise exception 'card kind is immutable'; end if;
  v:=coalesce(card.version,0)+1;
  if operation_kind='basic.put' then
    if (p->>'id')::uuid is distinct from target or p->>'kind' is distinct from 'basic'
      or jsonb_typeof(p->'front') is distinct from 'string' or jsonb_typeof(p->'back') is distinct from 'string'
      or length(p->>'front')>10000 or length(p->>'back')>10000
    then raise exception 'invalid question or answer' using errcode='22023'; end if;
    if not exists(select 1 from public.decks where id=(p->>'deckId')::uuid and user_id=u and deleted_at is null) then raise exception 'conflict:deck missing'; end if;
    insert into public.cards(id,user_id,kind,deck_id,front,back,created_at,version)
      values(target,u,'basic',(p->>'deckId')::uuid,btrim(p->>'front',E' \t\n\r'),btrim(p->>'back',E' \t\n\r'),public.occlude_millis(p->'createdAt'),v)
      on conflict(id,user_id) do update set deck_id=excluded.deck_id,front=excluded.front,back=excluded.back,updated_at=now(),version=v;
  else
    if card.id is null then raise exception 'conflict:basic missing'; end if;
    update public.cards set deleted_at=now(),updated_at=now(),version=v where id=target and user_id=u;
  end if;
  result:=jsonb_build_object('version',v);
  insert into public.sync_operations(id,user_id,device_id,operation_type,operation_payload,result) values(op,u,device,operation_kind,p_operation,result);
  return result;
end $$;
revoke all on function public.occlude_snapshot(),public.occlude_snapshot_v2(),public.occlude_apply_operation(jsonb) from public,anon;
grant execute on function public.occlude_snapshot(),public.occlude_snapshot_v2(),public.occlude_apply_operation(jsonb) to authenticated;

create table public.occlude_chatgpt_grants (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null, client_name text not null check(length(client_name) between 1 and 120),
  created_at timestamptz not null default now(), primary key(user_id,client_id)
);
alter table public.occlude_chatgpt_grants enable row level security;
revoke all on public.occlude_chatgpt_grants from public,anon,authenticated;

create function public.occlude_authorize_chatgpt(p_client_id uuid,p_client_name text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.occlude_direct_session() then raise exception 'direct user session required' using errcode='42501'; end if;
  insert into public.occlude_chatgpt_grants(user_id,client_id,client_name) values(auth.uid(),p_client_id,btrim(p_client_name))
    on conflict(user_id,client_id) do update set client_name=excluded.client_name;
end $$;
create function public.occlude_chatgpt_connections() returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.occlude_direct_session() then raise exception 'direct user session required' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('client_id',client_id,'name',client_name,'created_at',created_at)) from public.occlude_chatgpt_grants where user_id=auth.uid()),'[]');
end $$;
create function public.occlude_revoke_chatgpt(p_client_id uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.occlude_direct_session() then raise exception 'direct user session required' using errcode='42501'; end if;
  delete from public.occlude_chatgpt_grants where user_id=auth.uid() and client_id=p_client_id;
end $$;
create function public.occlude_require_chatgpt() returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid:=auth.uid(); begin
  if u is null or public.occlude_oauth_client_id() is null or not exists(
    select 1 from public.occlude_chatgpt_grants where user_id=u and client_id=public.occlude_oauth_client_id()
  ) then raise exception 'ChatGPT access not authorized or revoked' using errcode='42501'; end if;
  return u;
end $$;
revoke all on function public.occlude_require_chatgpt() from public,anon,authenticated;

create function public.occlude_mcp_list_decks() returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid:=public.occlude_require_chatgpt(); begin
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'parent_id',parent_id) order by name,id) from public.decks where user_id=u and deleted_at is null),'[]');
end $$;
create function public.occlude_mcp_create_cards(p_request_id uuid,p_deck_id uuid,p_deck_name text,p_cards jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  u uuid:=public.occlude_require_chatgpt(); previous public.sync_operations; payload jsonb; result jsonb;
  target uuid; selected_name text; item jsonb; card_id uuid; ids uuid[]:='{}';
begin
  if p_request_id is null or jsonb_typeof(p_cards) is distinct from 'array' or jsonb_array_length(p_cards) not between 1 and 50
    or (p_deck_id is not null and p_deck_name is not null)
    or jsonb_path_exists(p_cards,'$.**.user_id') or jsonb_path_exists(p_cards,'$.**.userId')
  then raise exception 'invalid card batch or forged ownership' using errcode='22023'; end if;
  payload:=jsonb_build_object('deck_id',p_deck_id,'deck_name',p_deck_name,'cards',p_cards);
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  select * into previous from public.sync_operations where id=p_request_id and user_id=u;
  if found then
    if previous.operation_type<>'mcp.create' or previous.operation_payload<>payload then raise exception 'request ID reused with different content' using errcode='22023'; end if;
    return previous.result;
  end if;
  if p_deck_id is not null then
    select id,d.name into target,selected_name from public.decks d where id=p_deck_id and user_id=u and deleted_at is null;
    if target is null then raise exception 'folder missing or unavailable' using errcode='22023'; end if;
  else
    selected_name:=coalesce(btrim(p_deck_name),'ChatGPT');
    if length(selected_name) not between 1 and 120 then raise exception 'invalid folder name' using errcode='22023'; end if;
    if (select count(*) from public.decks d where d.user_id=u and d.parent_id is null and d.deleted_at is null and lower(d.name)=lower(selected_name))>1 then raise exception 'ambiguous folder: use its ID' using errcode='22023'; end if;
    select id into target from public.decks d where d.user_id=u and d.parent_id is null and d.deleted_at is null and lower(d.name)=lower(selected_name);
    if target is null then
      target:=gen_random_uuid();
      insert into public.decks(id,user_id,name,created_at) values(target,u,selected_name,now());
    end if;
  end if;
  for item in select value from jsonb_array_elements(p_cards) loop
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'front') is distinct from 'string'
      or jsonb_typeof(item->'back') is distinct from 'string' or length(item->>'front')>10000 or length(item->>'back')>10000
      or exists(select 1 from jsonb_object_keys(item) k where k not in ('front','back'))
    then raise exception 'invalid question or answer' using errcode='22023'; end if;
    card_id:=gen_random_uuid();
    insert into public.cards(id,user_id,kind,deck_id,front,back,created_at) values(card_id,u,'basic',target,btrim(item->>'front',E' \t\n\r'),btrim(item->>'back',E' \t\n\r'),now());
    ids:=array_append(ids,card_id);
  end loop;
  result:=jsonb_build_object('created_count',cardinality(ids),'card_ids',ids,'deck_id',target,'deck_name',selected_name);
  insert into public.sync_operations(id,user_id,device_id,operation_type,operation_payload,result)
    values(p_request_id,u,public.occlude_oauth_client_id(),'mcp.create',payload,result);
  return result;
end $$;
revoke all on function public.occlude_authorize_chatgpt(uuid,text),public.occlude_chatgpt_connections(),public.occlude_revoke_chatgpt(uuid),public.occlude_mcp_list_decks(),public.occlude_mcp_create_cards(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.occlude_authorize_chatgpt(uuid,text),public.occlude_chatgpt_connections(),public.occlude_revoke_chatgpt(uuid),public.occlude_mcp_list_decks(),public.occlude_mcp_create_cards(uuid,uuid,text,jsonb) to authenticated;
commit;
