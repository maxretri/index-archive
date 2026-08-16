create or replace function public.search_index_file_ids(p_user_id uuid, p_query text)
returns table (file_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct f.id
  from public.files f
  left join public.file_tags ft on ft.file_id = f.id and ft.user_id = p_user_id
  left join public.tags t on t.id = ft.tag_id and t.user_id = p_user_id
  left join public.collection_files cf on cf.file_id = f.id and cf.user_id = p_user_id
  left join public.collections c on c.id = cf.collection_id and c.user_id = p_user_id
  where f.user_id = p_user_id
    and (
      f.search_document @@ websearch_to_tsquery('simple', p_query)
      or t.name ilike '%' || p_query || '%'
      or c.name ilike '%' || p_query || '%'
    );
$$;

revoke all on function public.search_index_file_ids(uuid, text) from public, anon, authenticated;
grant execute on function public.search_index_file_ids(uuid, text) to service_role;
