-- Apply after 202610170001_initial_sync.sql. Existing cards and reviews stay intact.
-- Old clients may omit label; their edits preserve any existing question.
begin;
alter table public.occlusion_regions add column label text not null default ''
  constraint occlusion_regions_label_length check (length(label)<=200);

create or replace function public.occlude_snapshot() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'authentication required' using errcode='42501'; end if;
  return jsonb_build_object(
    'schemaVersion',1,
    'features',jsonb_build_array('region-labels'),
    'decks',coalesce((select jsonb_agg(to_jsonb(t)) from public.decks t where t.user_id=u),'[]'),
    'images',coalesce((select jsonb_agg(to_jsonb(t)) from public.images t where t.user_id=u),'[]'),
    'regions',coalesce((select jsonb_agg(to_jsonb(t)) from public.occlusion_regions t where t.user_id=u),'[]'),
    'cards',coalesce((select jsonb_agg(to_jsonb(t)) from public.cards t where t.user_id=u),'[]'),
    'reviews',coalesce((select jsonb_agg(to_jsonb(t)) from public.review_events t where t.user_id=u),'[]'),
    'profile',(select to_jsonb(t) from public.profiles t where t.user_id=u)
  );
end $$;

create or replace function public.occlude_apply_operation(p_operation jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  u uuid := auth.uid(); op uuid := (p_operation->>'id')::uuid;
  device uuid := (p_operation->>'deviceId')::uuid; kind text := p_operation->>'kind';
  entity text := p_operation->>'entityId'; base bigint := (p_operation->>'baseVersion')::bigint;
  p jsonb := p_operation->'payload'; previous public.sync_operations;
  current_version bigint; v bigint; d public.decks; im public.images; r jsonb; c jsonb; rev public.review_events;
  target uuid; parent uuid; result jsonb; affected uuid[];
begin
  if u is null then raise exception 'authentication required' using errcode='42501'; end if;
  if op is null or device is null or entity is null or base is null or base<0 or jsonb_typeof(p) is distinct from 'object'
    or jsonb_path_exists(p_operation,'$.**.user_id') or jsonb_path_exists(p_operation,'$.**.userId')
  then raise exception 'invalid operation or forged ownership' using errcode='22023'; end if;
  -- Serialize this user's metadata graph, including cycle checks and idempotency.
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  select * into previous from public.sync_operations where id=op and user_id=u;
  if found then
    if previous.operation_payload<>p_operation then raise exception 'operation ID reused with different payload' using errcode='22023'; end if;
    return previous.result;
  end if;
  insert into public.profiles(user_id) values(u) on conflict do nothing;

  if kind in ('deck.put','deck.delete') then
    target:=entity::uuid;
    select * into d from public.decks where id=target and user_id=u;
    current_version:=coalesce(d.version,0);
    if current_version<>base or d.deleted_at is not null then raise exception 'conflict:deck:%',entity; end if;
    v:=current_version+1;
    if kind='deck.put' then
      if (p->>'id')::uuid is distinct from target then raise exception 'invalid deck ID'; end if;
      parent:=(p->>'parentId')::uuid;
      if parent is not null then
        if not exists(select 1 from public.decks where id=parent and user_id=u and deleted_at is null) then raise exception 'conflict:parent missing'; end if;
        if exists(with recursive ancestors as (
          select id,parent_id from public.decks where id=parent and user_id=u
          union select t.id,t.parent_id from public.decks t join ancestors a on t.id=a.parent_id where t.user_id=u
        ) select 1 from ancestors where id=target) then raise exception 'conflict:deck cycle'; end if;
      end if;
      insert into public.decks(id,user_id,parent_id,name,created_at,version)
      values(target,u,parent,btrim(p->>'name'),public.occlude_millis(p->'createdAt'),v)
      on conflict(id,user_id) do update set parent_id=excluded.parent_id,name=excluded.name,version=v,updated_at=now();
    else
      if d.id is null then raise exception 'conflict:deck missing'; end if;
      with recursive subtree as (
        select id from public.decks where id=target and user_id=u
        union select t.id from public.decks t join subtree s on t.parent_id=s.id where t.user_id=u
      ) select array_agg(id) into affected from subtree;
      update public.cards set deleted_at=coalesce(deleted_at,now()),updated_at=now(),version=version+1 where user_id=u and image_id in(select id from public.images where user_id=u and deck_id=any(affected));
      update public.occlusion_regions set deleted_at=coalesce(deleted_at,now()),updated_at=now(),version=version+1 where user_id=u and image_id in(select id from public.images where user_id=u and deck_id=any(affected));
      update public.images set deleted_at=coalesce(deleted_at,now()),updated_at=now(),version=version+1 where user_id=u and deck_id=any(affected);
      update public.decks set deleted_at=coalesce(deleted_at,now()),updated_at=now(),version=version+1 where user_id=u and id=any(affected);
    end if;
  elsif kind in ('image.put','image.delete') then
    target:=entity::uuid;
    select * into im from public.images where id=target and user_id=u;
    current_version:=coalesce(im.version,0);
    if current_version<>base or im.deleted_at is not null then raise exception 'conflict:image:%',entity; end if;
    v:=current_version+1;
    if kind='image.put' then
      if (p->>'id')::uuid is distinct from target then raise exception 'invalid image ID'; end if;
      if im.id is not null and im.content_hash is distinct from p->>'assetHash' then raise exception 'original image is immutable'; end if;
      if not exists(select 1 from public.decks where id=(p->>'deckId')::uuid and user_id=u and deleted_at is null) then raise exception 'conflict:deck missing'; end if;
      if not exists(select 1 from storage.objects where bucket_id='occlude-images' and name=u::text||'/'||(p->>'assetHash')) then raise exception 'image upload incomplete'; end if;
      if jsonb_typeof(p->'regions') is distinct from 'array' or jsonb_typeof(p->'cards') is distinct from 'array'
        or jsonb_array_length(p->'regions') not between 1 and 500 or jsonb_array_length(p->'regions')<>jsonb_array_length(p->'cards') then raise exception 'invalid masks'; end if;
      insert into public.images(id,user_id,deck_id,storage_path,content_hash,width,height,mime_type,created_at,version)
      values(target,u,(p->>'deckId')::uuid,u::text||'/'||(p->>'assetHash'),p->>'assetHash',(p->>'width')::integer,(p->>'height')::integer,p->>'mimeType',public.occlude_millis(p->'createdAt'),v)
      on conflict(id,user_id) do update set deck_id=excluded.deck_id,version=v,updated_at=now();
      for r in select value from jsonb_array_elements(p->'regions') loop
        if (r->>'imageId')::uuid is distinct from target then raise exception 'invalid region image'; end if;
        if exists(select 1 from public.occlusion_regions where id=(r->>'id')::uuid and user_id=u and (image_id<>target or deleted_at is not null)) then raise exception 'conflict:region missing or moved'; end if;
        if r ? 'label' and (jsonb_typeof(r->'label') is distinct from 'string' or length(r->>'label')>200) then raise exception 'invalid mask label' using errcode='22023'; end if;
        insert into public.occlusion_regions(id,user_id,image_id,x,y,width,height,label)
        values((r->>'id')::uuid,u,target,(r->>'x')::double precision,(r->>'y')::double precision,(r->>'width')::double precision,(r->>'height')::double precision,coalesce(btrim(r->>'label'),''))
        on conflict(id,user_id) do update set x=excluded.x,y=excluded.y,width=excluded.width,height=excluded.height,label=case when r ? 'label' then excluded.label else public.occlusion_regions.label end,updated_at=now(),version=public.occlusion_regions.version+1;
      end loop;
      if (select count(distinct value->>'id') from jsonb_array_elements(p->'regions'))<>jsonb_array_length(p->'regions') then raise exception 'duplicate masks'; end if;
      for c in select value from jsonb_array_elements(p->'cards') loop
        if (c->>'imageId')::uuid is distinct from target or not exists(select 1 from jsonb_array_elements(p->'regions') q where (q->>'id')::uuid=(c->>'regionId')::uuid) then raise exception 'invalid card region'; end if;
        if exists(select 1 from public.cards where user_id=u and ((id=(c->>'id')::uuid and (region_id<>(c->>'regionId')::uuid or deleted_at is not null)) or (region_id=(c->>'regionId')::uuid and id<>(c->>'id')::uuid))) then raise exception 'card identity is immutable'; end if;
        insert into public.cards(id,user_id,region_id,image_id,created_at)
        values((c->>'id')::uuid,u,(c->>'regionId')::uuid,target,public.occlude_millis(c->'createdAt')) on conflict(id,user_id) do nothing;
      end loop;
      if (select count(distinct value->>'regionId') from jsonb_array_elements(p->'cards'))<>jsonb_array_length(p->'regions') then raise exception 'one card per region required'; end if;
      update public.cards set deleted_at=coalesce(deleted_at,now()),updated_at=now(),version=version+1 where user_id=u and image_id=target and region_id not in(select (value->>'id')::uuid from jsonb_array_elements(p->'regions'));
      update public.occlusion_regions set deleted_at=coalesce(deleted_at,now()),updated_at=now(),version=version+1 where user_id=u and image_id=target and id not in(select (value->>'id')::uuid from jsonb_array_elements(p->'regions'));
    else
      if im.id is null then raise exception 'conflict:image missing'; end if;
      update public.images set deleted_at=now(),updated_at=now(),version=v where id=target and user_id=u;
      update public.occlusion_regions set deleted_at=coalesce(deleted_at,now()),updated_at=now(),version=version+1 where image_id=target and user_id=u;
      update public.cards set deleted_at=coalesce(deleted_at,now()),updated_at=now(),version=version+1 where image_id=target and user_id=u;
    end if;
  elsif kind='review.add' then
    target:=entity::uuid; v:=1;
    if (p->>'id')::uuid is distinct from target then raise exception 'invalid review ID'; end if;
    if jsonb_typeof(p->'rating') is distinct from 'number' or (p->>'rating')::integer not between 1 and 4
      or p->>'schedulerVersion' is distinct from 'ts-fsrs@5.4.2/default/fuzz-off' then raise exception 'invalid review'; end if;
    -- Even a concurrently deleted target retains its immutable review events.
    if not exists(select 1 from public.cards where id=(p->>'cardId')::uuid and user_id=u) then raise exception 'review target missing'; end if;
    select * into rev from public.review_events where id=target and user_id=u;
    if found then
      if rev.card_id<>(p->>'cardId')::uuid or rev.rating<>(p->>'rating')::smallint or rev.reviewed_at<>public.occlude_millis(p->'reviewedAt') or rev.scheduler_version<>p->>'schedulerVersion' then raise exception 'review ID reused'; end if;
    else
      insert into public.review_events(id,user_id,card_id,rating,reviewed_at,scheduler_version)
      values(target,u,(p->>'cardId')::uuid,(p->>'rating')::smallint,public.occlude_millis(p->'reviewedAt'),p->>'schedulerVersion');
    end if;
  elsif kind='settings.put' then
    select version into current_version from public.profiles where user_id=u;
    if current_version<>base then raise exception 'conflict:settings'; end if;
    if (p->>'newLimit')::integer not between 0 and 500 or (p->>'dayBoundary')::integer not between 0 and 23 or p->>'newLimit' is null or p->>'dayBoundary' is null then raise exception 'invalid preferences'; end if;
    v:=current_version+1;
    update public.profiles set settings=jsonb_build_object('newLimit',(p->>'newLimit')::integer,'dayBoundary',(p->>'dayBoundary')::integer),version=v where user_id=u;
  else raise exception 'invalid operation type' using errcode='22023';
  end if;
  result:=jsonb_build_object('version',v);
  insert into public.sync_operations(id,user_id,device_id,operation_type,operation_payload,result) values(op,u,device,kind,p_operation,result);
  return result;
end $$;

-- CREATE OR REPLACE retains the RPC permissions from the initial migration.
commit;
