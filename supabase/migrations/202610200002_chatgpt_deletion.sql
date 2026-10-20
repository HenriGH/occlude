-- Apply once after 202610200001. Existing grants keep creation-only access until
-- the user explicitly approves the expanded permission on the new consent page.
begin;

alter table public.occlude_chatgpt_grants add column can_manage boolean not null default false;

create function public.occlude_authorize_chatgpt_management(p_client_id uuid,p_client_name text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform public.occlude_authorize_chatgpt(p_client_id,p_client_name);
  update public.occlude_chatgpt_grants set can_manage=true where user_id=auth.uid() and client_id=p_client_id;
end $$;
create or replace function public.occlude_chatgpt_connections() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.occlude_direct_session() then raise exception 'direct user session required' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('client_id',client_id,'name',client_name,'created_at',created_at,'can_manage',can_manage)) from public.occlude_chatgpt_grants where user_id=auth.uid()),'[]');
end $$;
create function public.occlude_require_chatgpt_management() returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid:=public.occlude_require_chatgpt(); begin
  if not exists(select 1 from public.occlude_chatgpt_grants where user_id=u and client_id=public.occlude_oauth_client_id() and can_manage) then
    raise exception 'expanded ChatGPT access requires new consent' using errcode='42501';
  end if;
  return u;
end $$;
revoke all on function public.occlude_require_chatgpt_management() from public,anon,authenticated;

create function public.occlude_mcp_list_cards(p_deck_id uuid,p_query text,p_after uuid,p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid:=public.occlude_require_chatgpt_management(); result jsonb; begin
  if p_limit is null or p_limit not between 1 and 100 or length(coalesce(p_query,''))>200 then raise exception 'invalid search' using errcode='22023'; end if;
  if p_deck_id is not null and not exists(select 1 from public.decks where user_id=u and id=p_deck_id and deleted_at is null) then raise exception 'folder missing or unavailable' using errcode='22023'; end if;
  with recursive folders as (
    select id from public.decks where user_id=u and id=p_deck_id and deleted_at is null
    union select d.id from public.decks d join folders f on d.parent_id=f.id where d.user_id=u and d.deleted_at is null
  ), matches as (
    select c.id,c.version,c.kind,coalesce(c.deck_id,i.deck_id) deck_id,c.image_id,
      case when c.kind='basic' then c.front else coalesce(nullif(r.label,''),'Bildkarte ohne Beschriftung') end question
    from public.cards c
    left join public.images i on i.id=c.image_id and i.user_id=u
    left join public.occlusion_regions r on r.id=c.region_id and r.user_id=u
    where c.user_id=u and c.deleted_at is null and (p_after is null or c.id>p_after)
      and (p_deck_id is null or coalesce(c.deck_id,i.deck_id) in(select id from folders))
      and (p_query is null or position(lower(btrim(p_query)) in lower(case when c.kind='basic' then c.front else coalesce(r.label,'') end))>0)
    order by c.id limit p_limit+1
  ), page as (select * from matches order by id limit p_limit)
  select jsonb_build_object('cards',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from page p),'[]'),
    'next_after',case when (select count(*) from matches)>p_limit then (select id from page order by id desc limit 1) else null end) into result;
  return result;
end $$;

create function public.occlude_mcp_delete_cards(p_request_id uuid,p_cards jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  u uuid:=public.occlude_require_chatgpt_management(); previous public.sync_operations; payload jsonb:=jsonb_build_object('cards',p_cards);
  item jsonb; target public.cards; ids uuid[]:='{}'; regions uuid[]:='{}'; image_ids uuid[]:='{}'; deleted integer:=0; result jsonb;
begin
  if p_request_id is null or jsonb_typeof(p_cards) is distinct from 'array' or jsonb_array_length(p_cards) not between 1 and 100 then raise exception 'invalid deletion batch' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  select * into previous from public.sync_operations where user_id=u and id=p_request_id;
  if found then
    if previous.operation_type<>'mcp.delete_cards' or previous.operation_payload<>payload then raise exception 'request ID reused with different content' using errcode='22023'; end if;
    return previous.result;
  end if;
  for item in select value from jsonb_array_elements(p_cards) loop
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'id') is distinct from 'string'
      or jsonb_typeof(item->'version') is distinct from 'number' or item->>'version' !~ '^[1-9][0-9]{0,15}$'
      or exists(select 1 from jsonb_object_keys(item) k where k not in ('id','version')) then raise exception 'invalid card reference' using errcode='22023'; end if;
    if (item->>'id')::uuid=any(ids) then raise exception 'duplicate card reference' using errcode='22023'; end if;
    select * into target from public.cards where user_id=u and id=(item->>'id')::uuid;
    if not found then raise exception 'card missing or unavailable' using errcode='22023'; end if;
    if target.deleted_at is null then
      if target.version<>(item->>'version')::bigint then raise exception 'card changed: list cards again before deleting' using errcode='22023'; end if;
      deleted:=deleted+1;
      if target.region_id is not null then regions:=array_append(regions,target.region_id); image_ids:=array_append(image_ids,target.image_id); end if;
    end if;
    ids:=array_append(ids,target.id);
  end loop;
  update public.cards set deleted_at=now(),updated_at=now(),version=version+1 where user_id=u and id=any(ids) and deleted_at is null;
  update public.occlusion_regions set deleted_at=now(),updated_at=now(),version=version+1 where user_id=u and id=any(regions) and deleted_at is null;
  -- Bump the parent image version so an offline image editor cannot resurrect a
  -- deleted mask. Originals and immutable review history are retained.
  update public.images set updated_at=now(),version=version+1 where user_id=u and id=any(image_ids) and deleted_at is null;
  result:=jsonb_build_object('deleted_count',deleted,'already_deleted_count',cardinality(ids)-deleted,'card_ids',ids);
  insert into public.sync_operations(id,user_id,device_id,operation_type,operation_payload,result) values(p_request_id,u,public.occlude_oauth_client_id(),'mcp.delete_cards',payload,result);
  return result;
end $$;

-- Private consistent subtree state: versions/IDs include all content that a
-- folder deletion would remove. New or moved content invalidates the preview.
create function public.occlude_mcp_folder_state(p_user uuid,p_deck uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare ids uuid[]; state jsonb; folder_name text; begin
  select name into folder_name from public.decks where user_id=p_user and id=p_deck and deleted_at is null;
  if not found then raise exception 'folder missing or unavailable' using errcode='22023'; end if;
  with recursive folders as (
    select id from public.decks where user_id=p_user and id=p_deck and deleted_at is null
    union select d.id from public.decks d join folders f on d.parent_id=f.id where d.user_id=p_user and d.deleted_at is null
  ) select array_agg(id order by id) into ids from folders;
  select jsonb_build_object(
    'folders',coalesce((select jsonb_agg(jsonb_build_array(id,version) order by id) from public.decks where user_id=p_user and id=any(ids)),'[]'),
    'images',coalesce((select jsonb_agg(jsonb_build_array(id,version) order by id) from public.images where user_id=p_user and deck_id=any(ids) and deleted_at is null),'[]'),
    'regions',coalesce((select jsonb_agg(jsonb_build_array(r.id,r.version) order by r.id) from public.occlusion_regions r join public.images i on i.id=r.image_id and i.user_id=p_user where r.user_id=p_user and i.deck_id=any(ids) and r.deleted_at is null),'[]'),
    'cards',coalesce((select jsonb_agg(jsonb_build_array(c.id,c.version) order by c.id) from public.cards c left join public.images i on i.id=c.image_id and i.user_id=p_user where c.user_id=p_user and coalesce(c.deck_id,i.deck_id)=any(ids) and c.deleted_at is null),'[]')
  ) into state;
  return jsonb_build_object('folder_id',p_deck,'name',folder_name,'folder_ids',ids,'folder_count',cardinality(ids),
    'card_count',jsonb_array_length(state->'cards'),'image_count',jsonb_array_length(state->'images'),
    'snapshot_token',encode(sha256(convert_to(state::text,'UTF8')),'hex'));
end $$;
revoke all on function public.occlude_mcp_folder_state(uuid,uuid) from public,anon,authenticated;

create function public.occlude_mcp_preview_folder_deletion(p_deck_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid:=public.occlude_require_chatgpt_management(); begin
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  return public.occlude_mcp_folder_state(u,p_deck_id)-'folder_ids';
end $$;
create function public.occlude_mcp_delete_folder(p_request_id uuid,p_deck_id uuid,p_snapshot_token text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  u uuid:=public.occlude_require_chatgpt_management(); previous public.sync_operations;
  payload jsonb:=jsonb_build_object('folder_id',p_deck_id,'snapshot_token',p_snapshot_token); state jsonb; ids uuid[]; result jsonb;
begin
  if p_request_id is null or p_deck_id is null or p_snapshot_token is null or p_snapshot_token !~ '^[a-f0-9]{64}$' then raise exception 'invalid folder deletion' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  select * into previous from public.sync_operations where user_id=u and id=p_request_id;
  if found then
    if previous.operation_type<>'mcp.delete_folder' or previous.operation_payload<>payload then raise exception 'request ID reused with different content' using errcode='22023'; end if;
    return previous.result;
  end if;
  state:=public.occlude_mcp_folder_state(u,p_deck_id);
  if state->>'snapshot_token'<>p_snapshot_token then raise exception 'folder changed: preview again before deleting' using errcode='22023'; end if;
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(state->'folder_ids');
  update public.cards c set deleted_at=now(),updated_at=now(),version=version+1 where c.user_id=u and c.deleted_at is null
    and (c.deck_id=any(ids) or c.image_id in(select id from public.images where user_id=u and deck_id=any(ids)));
  update public.occlusion_regions set deleted_at=now(),updated_at=now(),version=version+1 where user_id=u and deleted_at is null and image_id in(select id from public.images where user_id=u and deck_id=any(ids));
  update public.images set deleted_at=now(),updated_at=now(),version=version+1 where user_id=u and deleted_at is null and deck_id=any(ids);
  update public.decks set deleted_at=now(),updated_at=now(),version=version+1 where user_id=u and deleted_at is null and id=any(ids);
  result:=jsonb_build_object('folder_id',p_deck_id,'deleted_folder_count',state->'folder_count','deleted_card_count',state->'card_count','deleted_image_count',state->'image_count');
  insert into public.sync_operations(id,user_id,device_id,operation_type,operation_payload,result) values(p_request_id,u,public.occlude_oauth_client_id(),'mcp.delete_folder',payload,result);
  return result;
end $$;
revoke all on function public.occlude_authorize_chatgpt_management(uuid,text),public.occlude_mcp_list_cards(uuid,text,uuid,integer),public.occlude_mcp_delete_cards(uuid,jsonb),public.occlude_mcp_preview_folder_deletion(uuid),public.occlude_mcp_delete_folder(uuid,uuid,text) from public,anon;
grant execute on function public.occlude_authorize_chatgpt_management(uuid,text),public.occlude_mcp_list_cards(uuid,text,uuid,integer),public.occlude_mcp_delete_cards(uuid,jsonb),public.occlude_mcp_preview_folder_deletion(uuid),public.occlude_mcp_delete_folder(uuid,uuid,text) to authenticated;

commit;
