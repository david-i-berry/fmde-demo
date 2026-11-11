-- NODAL schema. Plain PostgreSQL: portable from PGlite to a native server.

create table nodal_setting (
  key   text primary key,
  value jsonb not null
);

insert into nodal_setting (key, value) values
  ('lateAfterSeconds', '1200'),        -- node LATE when last seen longer ago than this (no data for 20 min)
  ('silentAfterSeconds', '1800'),      -- node SILENT when last seen longer ago than this (30 min)
  ('retentionDays', '7'),              -- observations, message log and issues
  ('futureToleranceSeconds', '60');    -- clock tolerance for TIME_IN_FUTURE

-- Current record per node. Created on the first message of any kind for the topic.
create table node (
  node_key             text primary key,
  group_id             text not null,
  node_id              text not null,
  topic                text not null,
  declared_id          text,
  name                 text,
  serial_number        text,
  firmware_version     text,
  url                  text,
  location             jsonb,
  metadata_version     integer,          -- null until metadata is received
  metadata_hash        text,
  metadata_received_at timestamptz,       -- when the current version was first received
  metadata_seen_at     timestamptz,       -- last receipt, including identical republishes
  metadata_cleared_at  timestamptz,       -- zero-length retained message received
  first_seen_at        timestamptz not null,
  hub_config           jsonb not null default '{}'
);

-- One row per distinct metadata content (identical republishes do not create versions).
create table metadata_version (
  node_key     text not null references node (node_key) on delete cascade,
  version      integer not null,
  received_at  timestamptz not null,
  content_hash text not null,
  message      jsonb not null,             -- full decoded Metadata
  normalised   jsonb not null,             -- MetadataVersion (packages/model)
  raw_bytes    integer not null,
  raw          bytea not null,
  primary key (node_key, version)
);

create table observer_device (
  node_key         text not null,
  metadata_version integer not null,
  id               bigint not null,
  name             text not null,
  serial_number    text,
  firmware_version text,
  url              text,
  location         jsonb,
  primary key (node_key, metadata_version, id),
  foreign key (node_key, metadata_version) references metadata_version (node_key, version) on delete cascade
);

create table parameter (
  node_key               text not null,
  metadata_version       integer not null,
  definition_id          bigint not null,
  value_index            integer not null,
  param_key              text not null,
  series_key             text not null,
  definition_description text not null,
  long_name              text not null,
  unit                   text not null,
  standard_names         jsonb not null,
  device_kind            text not null,     -- node | observer | unspecified
  observer_id            bigint,
  cell_method            text not null,
  cell_period_seconds    bigint not null,
  primary key (node_key, metadata_version, definition_id, value_index),
  foreign key (node_key, metadata_version) references metadata_version (node_key, version) on delete cascade
);
create index parameter_series on parameter (series_key);

-- Message log: one row per data message. id = hash of topic + payload, so QoS 1 redeliveries
-- and replays of the same message are recognised and skipped.
create table data_message (
  id               text primary key,
  node_key         text not null references node (node_key) on delete cascade,
  topic            text not null,
  received_at      timestamptz not null,
  first_obs_time   timestamptz,
  last_obs_time    timestamptz,
  observations     integer not null,
  values_count     integer not null,
  empty_values     integer not null,
  latency_seconds  double precision,       -- received_at - last_obs_time
  span_seconds     double precision,       -- received_at - first_obs_time (backlog depth)
  payload_bytes    integer not null,
  raw              bytea not null,
  metadata_version integer,
  conformance      jsonb not null default '[]'
);
create index data_message_node_received on data_message (node_key, received_at);
create index data_message_received on data_message (received_at);

-- Observations keyed by series (stable across metadata versions) and time: a value
-- delivered twice (redelivery, store-and-forward resend) is stored once.
create table observation (
  series_key       text not null,
  obs_time         timestamptz not null,
  node_key         text not null,
  param_key        text not null,
  metadata_version integer not null,
  definition_id    bigint not null,
  value_kind       text not null,
  value_num        double precision,
  value_text       text,                   -- strings, and exact text of 64-bit integers
  value_bool       boolean,
  is_empty         boolean not null,
  message_id       text not null,
  received_at      timestamptz not null,
  primary key (series_key, obs_time)
);
create index observation_node_time on observation (node_key, obs_time);
create index observation_param_time on observation (param_key, obs_time);

-- Every conformance issue, for any message kind (including undecodable ones).
create table conformance_issue (
  id          bigserial primary key,
  received_at timestamptz not null,
  topic       text not null,
  node_key    text,
  message_id  text,
  kind        text not null,               -- metadata | data | unknown
  code        text not null,
  severity    text not null default 'error', -- error | warning (CODE_INFO in packages/model/src/ats.ts)
  test        text,                         -- FMDE ATS test label, e.g. /conf/message-encoding/node
  detail      text not null
);
create index conformance_issue_received on conformance_issue (received_at);
create index conformance_issue_node on conformance_issue (node_key, received_at);

-- When the hub was actually listening. Time outside these intervals is
-- "not monitored", never "missing".
create table monitored_interval (
  id      bigserial primary key,
  source  text not null,
  from_ts timestamptz not null,
  to_ts   timestamptz not null
);
