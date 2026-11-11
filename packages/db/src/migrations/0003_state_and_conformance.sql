-- Node state and conformance are separate (29 Oct 2026):
--   state        "is it working?"  NO_METADATA, NEVER_SEEN, SILENT, LATE, DEGRADED, OK
--   conformance  "does it meet FMDE?"  CONFORMANT, WARNINGS, NON_CONFORMANT
-- DEGRADED now means data was lost in the window: empty values (except parameters the hub
-- configuration lists in expectedEmpty, by long name or series key), or observations that could
-- not be decoded or stored. Conformance issues alone never degrade a node.
-- Conformance counts the issues of the current metadata version (whenever it was received) plus
-- those of data messages in the window.

drop function nodal_node_status(timestamptz, timestamptz, timestamptz);

create function nodal_node_status(p_from timestamptz, p_to timestamptz, p_now timestamptz)
returns table (
  node_key                text,
  group_id                text,
  node_id                 text,
  name                    text,
  state                   text,
  conformance             text,
  metadata_version        integer,
  first_seen_at           timestamptz,
  last_seen_at            timestamptz,
  last_seen_age_seconds   double precision,
  messages                bigint,
  observations            bigint,
  empty_values            bigint,
  expected_empty_values   bigint,
  lost_data               bigint,
  conformance_errors      bigint,
  conformance_warnings    bigint,
  median_latency_seconds  double precision,
  max_span_seconds        double precision
)
language sql stable as $$
  with expected as (
    select n.node_key,
           coalesce(array(select jsonb_array_elements_text(n.hub_config -> 'expectedEmpty')), '{}'::text[]) as names
    from node n
  ),
  msg as (
    select m.node_key,
           count(*) filter (where m.received_at >= p_from and m.received_at < p_to)                         as messages,
           coalesce(sum(m.observations) filter (where m.received_at >= p_from and m.received_at < p_to), 0) as observations,
           percentile_cont(0.5) within group (order by m.latency_seconds)
             filter (where m.received_at >= p_from and m.received_at < p_to)                                as median_latency,
           max(m.span_seconds) filter (where m.received_at >= p_from and m.received_at < p_to)              as max_span,
           max(m.received_at) filter (where m.received_at <= p_now)                                         as last_seen
    from data_message m
    group by m.node_key
  ),
  empties as (
    -- series_key = node|device|longName|cellMethod|period: part 3 is the long name
    select o.node_key,
           count(*) filter (where not (o.series_key = any(e.names) or split_part(o.series_key, '|', 3) = any(e.names))) as counted,
           count(*) filter (where o.series_key = any(e.names) or split_part(o.series_key, '|', 3) = any(e.names))     as expected
    from observation o
    join expected e on e.node_key = o.node_key
    where o.is_empty and o.received_at >= p_from and o.received_at < p_to
    group by o.node_key
  ),
  issues as (
    select c.node_key,
           -- observations that could not be decoded or stored: data lost
           count(*) filter (where c.received_at >= p_from and c.received_at < p_to
                              and c.code in ('DECODE_ERROR', 'UNKNOWN_DEFINITION', 'VALUE_COUNT_MISMATCH', 'MISSING_TIME', 'NO_METADATA')) as lost,
           count(*) filter (where c.severity = 'error' and (
                              (c.kind = 'metadata' and c.received_at >= n.metadata_received_at)
                              or (c.kind <> 'metadata' and c.received_at >= p_from and c.received_at < p_to))) as errors,
           count(*) filter (where c.severity <> 'error' and (
                              (c.kind = 'metadata' and c.received_at >= n.metadata_received_at)
                              or (c.kind <> 'metadata' and c.received_at >= p_from and c.received_at < p_to))) as warnings
    from conformance_issue c
    join node n on n.node_key = c.node_key
    group by c.node_key
  ),
  base as (
    select n.*,
           msg.last_seen,
           extract(epoch from p_now - coalesce(msg.last_seen, n.metadata_received_at, n.first_seen_at)) as quiet_seconds,
           coalesce((n.hub_config ->> 'lateAfterSeconds')::double precision, nodal_setting_num('lateAfterSeconds'))     as late_after,
           coalesce((n.hub_config ->> 'silentAfterSeconds')::double precision, nodal_setting_num('silentAfterSeconds')) as silent_after,
           coalesce(msg.messages, 0)     as messages,
           coalesce(msg.observations, 0) as observations,
           coalesce(em.counted, 0)       as empty_values,
           coalesce(em.expected, 0)      as expected_empty_values,
           coalesce(i.lost, 0)           as lost_data,
           coalesce(i.errors, 0)         as conformance_errors,
           coalesce(i.warnings, 0)       as conformance_warnings,
           msg.median_latency,
           msg.max_span
    from node n
    left join msg on msg.node_key = n.node_key
    left join empties em on em.node_key = n.node_key
    left join issues i on i.node_key = n.node_key
  )
  select b.node_key, b.group_id, b.node_id, b.name,
         case
           when b.metadata_version is null or b.metadata_cleared_at is not null then 'NO_METADATA'
           when b.last_seen is null then 'NEVER_SEEN'
           when b.quiet_seconds > b.silent_after then 'SILENT'
           when b.quiet_seconds > b.late_after then 'LATE'
           when b.empty_values > 0 or b.lost_data > 0 then 'DEGRADED'
           else 'OK'
         end,
         case
           when b.conformance_errors > 0 then 'NON_CONFORMANT'
           when b.conformance_warnings > 0 then 'WARNINGS'
           else 'CONFORMANT'
         end,
         b.metadata_version, b.first_seen_at, b.last_seen,
         extract(epoch from p_now - b.last_seen)::double precision,
         b.messages, b.observations::bigint, b.empty_values, b.expected_empty_values, b.lost_data,
         b.conformance_errors, b.conformance_warnings,
         b.median_latency, b.max_span
  from base b
  order by b.node_key
$$;
