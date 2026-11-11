-- Derived metrics as SQL, so every view and a future server compute the same numbers.
-- Expected reporting frequency is deferred, so availability and timeliness are not computed yet;
-- node state uses last-seen thresholds (global settings, overridable per node in hub_config).

create function nodal_setting_num(p_key text) returns double precision
language sql stable as $$
  select (value #>> '{}')::double precision from nodal_setting where key = p_key
$$;

-- Per-node status over the window [p_from, p_to), evaluated at p_now.
-- State, in order: NO_METADATA, SILENT, LATE, DEGRADED (empty values or conformance errors
-- in the window; warnings do not degrade), OK. A node with no data yet but valid metadata is SILENT once past the threshold.
create function nodal_node_status(p_from timestamptz, p_to timestamptz, p_now timestamptz)
returns table (
  node_key                text,
  group_id                text,
  node_id                 text,
  name                    text,
  state                   text,
  metadata_version        integer,
  first_seen_at           timestamptz,
  last_seen_at            timestamptz,
  last_seen_age_seconds   double precision,
  messages                bigint,
  observations            bigint,
  empty_values            bigint,
  conformance_issues      bigint,
  conformance_warnings    bigint,
  median_latency_seconds  double precision,
  max_span_seconds        double precision
)
language sql stable as $$
  with msg as (
    select m.node_key,
           count(*) filter (where m.received_at >= p_from and m.received_at < p_to)                       as messages,
           coalesce(sum(m.observations) filter (where m.received_at >= p_from and m.received_at < p_to), 0) as observations,
           coalesce(sum(m.empty_values) filter (where m.received_at >= p_from and m.received_at < p_to), 0) as empty_values,
           percentile_cont(0.5) within group (order by m.latency_seconds)
             filter (where m.received_at >= p_from and m.received_at < p_to)                              as median_latency,
           max(m.span_seconds) filter (where m.received_at >= p_from and m.received_at < p_to)            as max_span
    from data_message m
    group by m.node_key
  ),
  last_seen as (
    select m.node_key, max(m.received_at) as at
    from data_message m
    where m.received_at <= p_now
    group by m.node_key
  ),
  issues as (
    select c.node_key, count(*) filter (where c.severity = 'error') as n, count(*) filter (where c.severity <> 'error') as w
    from conformance_issue c
    where c.received_at >= p_from and c.received_at < p_to and c.node_key is not null
    group by c.node_key
  ),
  base as (
    select n.*,
           ls.at as last_seen_at,
           extract(epoch from p_now - coalesce(ls.at, n.metadata_received_at, n.first_seen_at)) as quiet_seconds,
           coalesce((n.hub_config ->> 'lateAfterSeconds')::double precision, nodal_setting_num('lateAfterSeconds'))     as late_after,
           coalesce((n.hub_config ->> 'silentAfterSeconds')::double precision, nodal_setting_num('silentAfterSeconds')) as silent_after,
           coalesce(msg.messages, 0)      as messages,
           coalesce(msg.observations, 0)  as observations,
           coalesce(msg.empty_values, 0)  as empty_values,
           coalesce(i.n, 0)               as conformance_issues,
           coalesce(i.w, 0)               as conformance_warnings,
           msg.median_latency,
           msg.max_span
    from node n
    left join last_seen ls on ls.node_key = n.node_key
    left join msg on msg.node_key = n.node_key
    left join issues i on i.node_key = n.node_key
  )
  select b.node_key, b.group_id, b.node_id, b.name,
         case
           when b.metadata_version is null or b.metadata_cleared_at is not null then 'NO_METADATA'
           when b.quiet_seconds > b.silent_after then 'SILENT'
           when b.quiet_seconds > b.late_after then 'LATE'
           when b.empty_values > 0 or b.conformance_issues > 0 then 'DEGRADED'
           else 'OK'
         end,
         b.metadata_version, b.first_seen_at, b.last_seen_at,
         extract(epoch from p_now - b.last_seen_at)::double precision,
         b.messages, b.observations::bigint, b.empty_values::bigint, b.conformance_issues, b.conformance_warnings,
         b.median_latency, b.max_span
  from base b
  order by b.node_key
$$;

-- Retention: observations, message log and issues older than retentionDays. Metadata is kept.
create function nodal_prune(p_now timestamptz) returns void
language sql as $$
  delete from observation where received_at < p_now - make_interval(days => nodal_setting_num('retentionDays')::int);
  delete from data_message where received_at < p_now - make_interval(days => nodal_setting_num('retentionDays')::int);
  delete from conformance_issue where received_at < p_now - make_interval(days => nodal_setting_num('retentionDays')::int);
  delete from monitored_interval where to_ts < p_now - make_interval(days => nodal_setting_num('retentionDays')::int);
$$;
