import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Supabase supplies these schemas/roles in production. Tests use real PostgreSQL
// RLS/transactions with a minimal Auth/Storage schema, not the hosted HTTP services.
export async function sqlBackend({ through }: { through?: string } = {}) {
  const pg = new PGlite()
  await pg.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to authenticated,anon;
    grant select,insert,update,delete on storage.objects to authenticated;
  `)
  for (const migration of (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql') && (!through || name <= through)).sort()) {
    await pg.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'))
  }
  return pg
}
