-- Apply this complete file once after the four earlier migrations.
begin;

create function public.occlude_valid_card_svg(p_svg text) returns boolean
language sql immutable set search_path=pg_catalog as $$
  select p_svg is not null and length(p_svg)<=100000 and (p_svg='' or (
    btrim(p_svg) like '<svg%' and p_svg ~ 'xmlns\s*=\s*["'']http://www.w3.org/2000/svg["'']'
    and p_svg !~ '<[!?]' and p_svg !~* '<\s*(script|foreignObject|style|image|use|animate[^\s/>]*|set|iframe|audio|video)(\s|/|>)'
    and p_svg !~* '\s(on[[:alnum:]_-]+|href|xlink:href|style)\s*='
  ))
$$;
revoke all on function public.occlude_valid_card_svg(text) from public,anon;
grant execute on function public.occlude_valid_card_svg(text) to authenticated;
alter table public.cards add column front_svg text not null default '';
alter table public.cards add column back_svg text not null default '';
alter table public.cards add constraint cards_svg_passive check(
  public.occlude_valid_card_svg(front_svg) and public.occlude_valid_card_svg(back_svg)
  and (kind='basic' or (front_svg='' and back_svg=''))
);

create or replace function public.occlude_snapshot_v2() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not public.occlude_direct_session() then raise exception 'direct user session required' using errcode='42501'; end if;
  return public.occlude_snapshot_v1() || jsonb_build_object('features',jsonb_build_array('region-labels','basic-cards','card-svg'));
end $$;

-- Old clients omit graphic fields: preserve them. New clients clear them with
-- explicit empty strings. Retry acknowledgments never reapply an old graphic.
alter function public.occlude_apply_operation(jsonb) rename to occlude_apply_operation_v2;
revoke all on function public.occlude_apply_operation_v2(jsonb) from public,anon,authenticated;
create function public.occlude_apply_operation(p_operation jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  u uuid:=auth.uid(); p jsonb:=p_operation->'payload'; result jsonb; seen boolean;
begin
  if u is null or not public.occlude_direct_session() then raise exception 'direct user session required' using errcode='42501'; end if;
  if p_operation->>'kind'='basic.put' then
    if (p ? 'frontSvg' and (jsonb_typeof(p->'frontSvg') is distinct from 'string' or not public.occlude_valid_card_svg(p->>'frontSvg')))
      or (p ? 'backSvg' and (jsonb_typeof(p->'backSvg') is distinct from 'string' or not public.occlude_valid_card_svg(p->>'backSvg')))
    then raise exception 'invalid SVG graphic' using errcode='22023'; end if;
    perform pg_advisory_xact_lock(hashtextextended(u::text,0));
    select exists(select 1 from public.sync_operations where user_id=u and id=(p_operation->>'id')::uuid) into seen;
    result:=public.occlude_apply_operation_v2(p_operation);
    if not seen then
      update public.cards set front_svg=coalesce(p->>'frontSvg',front_svg),back_svg=coalesce(p->>'backSvg',back_svg)
        where user_id=u and id=(p_operation->>'entityId')::uuid;
    end if;
    return result;
  end if;
  return public.occlude_apply_operation_v2(p_operation);
end $$;
revoke all on function public.occlude_apply_operation(jsonb) from public,anon;
grant execute on function public.occlude_apply_operation(jsonb) to authenticated;

create or replace function public.occlude_mcp_create_cards(p_request_id uuid,p_deck_id uuid,p_deck_name text,p_cards jsonb) returns jsonb
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
      or exists(select 1 from jsonb_object_keys(item) k where k not in ('front','back','front_svg','back_svg'))
      or (item ? 'front_svg' and (jsonb_typeof(item->'front_svg') is distinct from 'string' or not public.occlude_valid_card_svg(item->>'front_svg')))
      or (item ? 'back_svg' and (jsonb_typeof(item->'back_svg') is distinct from 'string' or not public.occlude_valid_card_svg(item->>'back_svg')))
    then raise exception 'invalid question, answer or SVG' using errcode='22023'; end if;
    card_id:=gen_random_uuid();
    insert into public.cards(id,user_id,kind,deck_id,front,back,front_svg,back_svg,created_at) values(card_id,u,'basic',target,btrim(item->>'front',E' \t\n\r'),btrim(item->>'back',E' \t\n\r'),coalesce(item->>'front_svg',''),coalesce(item->>'back_svg',''),now());
    ids:=array_append(ids,card_id);
  end loop;
  result:=jsonb_build_object('created_count',cardinality(ids),'card_ids',ids,'deck_id',target,'deck_name',selected_name);
  insert into public.sync_operations(id,user_id,device_id,operation_type,operation_payload,result)
    values(p_request_id,u,public.occlude_oauth_client_id(),'mcp.create',payload,result);
  return result;
end $$;

-- SVG content travels once per card version, not in every background pull.
-- Deleted cards never need their artwork again. Other metadata/history still
-- use the established consistent full snapshot protocol.
create function public.occlude_snapshot_v3(p_known_cards jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb; begin
  if jsonb_typeof(p_known_cards) is distinct from 'object' or length(p_known_cards::text)>1000000 then raise exception 'invalid known card versions' using errcode='22023'; end if;
  result:=public.occlude_snapshot_v2();
  return result || jsonb_build_object('cards',coalesce((
    select jsonb_agg(case
      when c->>'deleted_at' is not null then c-'front_svg'-'back_svg'
      when c->>'kind'='basic' and p_known_cards->(c->>'id')=c->'version' then (c-'front_svg'-'back_svg') || jsonb_build_object('svg_unchanged',true)
      else c end)
    from jsonb_array_elements(result->'cards') c
  ),'[]'));
end $$;
revoke all on function public.occlude_snapshot_v3(jsonb) from public,anon;
grant execute on function public.occlude_snapshot_v3(jsonb) to authenticated;

commit;
