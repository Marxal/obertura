// What a backup holds and how it becomes SQL again. No I/O here, so the restore
// can be rehearsed against a throwaway Postgres.
//
// ── THE FORMAT ──────────────────────────────────────────────────────────────
// One JSON file: every row of the public tables plus auth.users and
// auth.identities (so people keep their logins), and the live definitions of
// the tables, functions, triggers, policies, grants and cron jobs. Sessions are
// left out on purpose: after a restore, people simply sign in again.
//
// ── WHY NOT pg_dump ─────────────────────────────────────────────────────────
// `supabase db dump` runs pg_dump inside Docker, and a backup that needs Docker
// Desktop open is one that doesn't get made. This takes the same read-only route
// as `npm run admin` and needs nothing running.

export const BACKUP_FORMAT = 1;
export const AUTH_TABLES = ['auth.users', 'auth.identities'];

// One statement, so every table comes from the same moment.
export function dataSql(publicTables) {
  const all = [...AUTH_TABLES, ...publicTables.map((t) => `public.${t}`)];
  const parts = all.map((t) => {
    const [s, n] = t.split('.');
    return `'${t}', (select coalesce(json_agg(x), '[]'::json) from "${s}"."${n}" x)`;
  });
  return `select json_build_object(${parts.join(', ')}) as data`;
}

export const SCHEMA_SQL = {
  columns: `select n.nspname as sch, c.relname as tbl, a.attname as col, format_type(a.atttypid, a.atttypmod) as type,
      a.attnotnull as notnull, pg_get_expr(d.adbin, d.adrelid) as dflt, a.attgenerated::text as gen
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attnum > 0 and not a.attisdropped and c.relkind = 'r'
      and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname in ('users', 'identities')))
    order by n.nspname, c.relname, a.attnum`,
  constraints: `select c.relname as tbl, k.conname as name, k.contype::text as kind, pg_get_constraintdef(k.oid) as def
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' order by c.relname, k.conname`,
  indexes: `select i.indexdef as def from pg_indexes i
    where i.schemaname = 'public' and not exists (
      select 1 from pg_constraint k where k.conname = i.indexname and k.connamespace = 'public'::regnamespace)
    order by i.indexname`,
  rls: `select c.relname as tbl from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`,
  functions: `select p.proname as name, pg_get_functiondef(p.oid) as def from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    order by p.proname`,
  triggers: `select pg_get_triggerdef(t.oid) as def from pg_trigger t
    join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal and (n.nspname = 'public' or p.pronamespace = 'public'::regnamespace)
    order by t.tgname`,
  policies: `select tablename as tbl, policyname as name, permissive, roles::text[] as roles, cmd, qual, with_check
    from pg_policies where schemaname = 'public' order by tablename, policyname`,
  tableGrants: `select c.relname as tbl, null::text as col, g.privilege_type as priv,
      case g.grantee when 0 then 'public' else pg_get_userbyid(g.grantee) end as role
    from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) g
    where n.nspname = 'public' and c.relkind = 'r'
    union all
    select c.relname, a.attname::text, g.privilege_type,
      case g.grantee when 0 then 'public' else pg_get_userbyid(g.grantee) end
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace,
      aclexplode(a.attacl) g
    where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped`,
  functionGrants: `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
      case g.grantee when 0 then 'public' else pg_get_userbyid(g.grantee) end as role
    from pg_proc p, aclexplode(p.proacl) g
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`,
  cron: `select jobname, schedule, command, active from cron.job order by jobname`,
  extras: `select c.relkind::text as kind, c.relname as name from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm', 'S', 'f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')`,
};

const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;
const literal = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Text in a backup is written by users. It goes into SQL only inside a dollar
// quote whose tag is proven absent from that text, so nothing can close it.
function dollar(text) {
  for (let i = 0; ; i++) {
    const tag = `$bito${i}$`;
    if (!text.includes(tag)) return `${tag}${text}${tag}`;
  }
}

function columnsOf(backup, table) {
  const [sch, tbl] = table.split('.');
  const cols = backup.schema.columns.filter((c) => c.sch === sch && c.tbl === tbl && !c.gen);
  if (!cols.length) throw new Error(`The backup has no column list for ${table}.`);
  return cols.map((c) => c.col);
}

function insertFrom(backup, table, rows, conflict) {
  if (!rows.length) return `-- ${table}: nothing to restore`;
  const cols = columnsOf(backup, table).map(ident).join(', ');
  const [s, n] = table.split('.');
  const target = `${ident(s)}.${ident(n)}`;
  return `insert into ${target} (${cols})
select ${cols} from jsonb_populate_recordset(null::${target}, ${dollar(JSON.stringify(rows))}::jsonb)
${conflict};`;
}

// The tables, rules and permissions, for an empty project. Grants are replayed
// after a blanket revoke because a new project's default privileges are wide, and
// `entitled` is protected by exactly these column grants: skipping them would let
// anyone give themselves paid access.
export function schemaStatements(backup) {
  const s = backup.schema;
  const out = ['create extension if not exists pg_cron;'];
  const tables = [...new Set(s.columns.filter((c) => c.sch === 'public').map((c) => c.tbl))];
  for (const t of tables) {
    const defs = s.columns.filter((c) => c.sch === 'public' && c.tbl === t).map((c) => {
      const gen = c.gen ? ` generated always as (${c.dflt}) stored` : c.dflt ? ` default ${c.dflt}` : '';
      return `  ${ident(c.col)} ${c.type}${gen}${c.notnull ? ' not null' : ''}`;
    });
    out.push(`create table if not exists public.${ident(t)} (\n${defs.join(',\n')}\n);`);
  }
  const order = { p: 0, u: 1, c: 2, f: 3 };
  const cons = [...s.constraints].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
  for (const c of cons) out.push(`alter table public.${ident(c.tbl)} add constraint ${ident(c.name)} ${c.def};`);
  for (const i of s.indexes) out.push(`${i.def};`);
  for (const t of s.rls) out.push(`alter table public.${ident(t.tbl)} enable row level security;`);
  for (const f of s.functions) out.push(`${f.def};`);
  for (const t of s.triggers) out.push(`${t.def};`);
  for (const p of s.policies) {
    const using = p.qual ? ` using (${p.qual})` : '';
    const check = p.with_check ? ` with check (${p.with_check})` : '';
    const roles = p.roles.map((r) => (r === 'public' ? 'public' : ident(r))).join(', ');
    out.push(`create policy ${ident(p.name)} on public.${ident(p.tbl)} as ${p.permissive} for ${p.cmd} to ${roles}${using}${check};`);
  }
  for (const t of tables) out.push(`revoke all on public.${ident(t)} from public, anon, authenticated, service_role;`);
  for (const g of s.tableGrants) {
    if (g.role === 'postgres') continue;
    const who = g.role === 'public' ? 'public' : ident(g.role);
    const col = g.col ? ` (${ident(g.col)})` : '';
    out.push(`grant ${g.priv}${col} on public.${ident(g.tbl)} to ${who};`);
  }
  const fns = [...new Map(s.functionGrants.map((g) => [`${g.name}(${g.args})`, g])).keys()];
  for (const f of fns) out.push(`revoke all on function public.${f} from public, anon, authenticated, service_role;`);
  for (const g of s.functionGrants) {
    if (g.role === 'postgres') continue;
    const who = g.role === 'public' ? 'public' : ident(g.role);
    out.push(`grant execute on function public.${g.name}(${g.args}) to ${who};`);
  }
  for (const j of s.cron) {
    out.push(`select cron.schedule(${literal(j.jobname)}, ${literal(j.schedule)}, ${dollar(j.command)});`);
  }
  return out;
}

/**
 * The SQL that puts a backup back. By default it only adds what is missing and
 * never changes a row that exists. `accountIds` narrows it to those accounts;
 * `replace` then also overwrites their profile row with the backup's copy.
 * `withSchema` first rebuilds everything, for an empty project.
 */
export function buildRestoreSql(backup, { accountIds = null, replace = false, withSchema = false } = {}) {
  if (backup.format !== BACKUP_FORMAT) throw new Error(`Unknown backup format: ${backup.format}`);
  if (replace && !accountIds) throw new Error('Replacing is only for named accounts.');
  const keep = accountIds ? new Set(accountIds) : null;
  const pick = (table, key) => {
    const rows = backup.tables[table] ?? [];
    return keep ? rows.filter((r) => keep.has(r[key])) : rows;
  };
  const users = pick('auth.users', 'id');
  const userIds = new Set(backup.tables['auth.users'].map((u) => u.id));
  const out = ['begin;', 'set local search_path = public, extensions;'];
  if (withSchema) out.push(...schemaStatements(backup));

  // Adding a user fires handle_new_user, which makes an empty profile. So note
  // who was missing first: their empty profile is the one row that may be
  // overwritten. The guards are off for this transaction only, because the
  // free-games guard would otherwise strip games from the restored rows.
  out.push('alter table public.profiles disable trigger user;');
  out.push('create temp table _bito_overwrite (id uuid primary key) on commit drop;');
  out.push(`insert into _bito_overwrite select id from jsonb_populate_recordset(null::_bito_overwrite, ${dollar(JSON.stringify(users.map((u) => ({ id: u.id }))))}::jsonb)${
    replace ? '' : ' where id not in (select id from auth.users)'
  };`);
  out.push(insertFrom(backup, 'auth.users', users, 'on conflict do nothing'));
  out.push(insertFrom(backup, 'auth.identities', pick('auth.identities', 'user_id'), 'on conflict do nothing'));

  const profiles = pick('public.profiles', 'id').filter((p) => userIds.has(p.id));
  const profileCols = columnsOf(backup, 'public.profiles').filter((c) => c !== 'id');
  const set = profileCols.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ');
  out.push(insertFrom(backup, 'public.profiles', profiles,
    `on conflict (id) do update set ${set} where public.profiles.id in (select id from _bito_overwrite)`));
  out.push(insertFrom(backup, 'public.stats_daily',
    pick('public.stats_daily', 'id').filter((r) => userIds.has(r.id)), 'on conflict do nothing'));
  // Anonymous counts belong to no account, so a single-account restore skips them,
  // along with any table this script has no rule for.
  if (!keep) {
    for (const t of Object.keys(backup.tables)) {
      if (t.startsWith('public.') && t !== 'public.profiles' && t !== 'public.stats_daily') {
        out.push(insertFrom(backup, t, backup.tables[t], 'on conflict do nothing'));
      }
    }
  }
  out.push('alter table public.profiles enable trigger user;', 'commit;');
  return `${out.join('\n')}\n`;
}
