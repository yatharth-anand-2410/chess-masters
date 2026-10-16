-- Backfill analyses.game_summary for rows analyzed before the telemetry
-- rollout (0014_game_telemetry.sql). Everything comes from the stored PGN
-- headers plus the row's own columns — no engine run, no estimates:
--
--   speed / time_control  <- the [TimeControl "..."] header
--   player_elo / opponent_elo / opponent_name <- WhiteElo/BlackElo/White/Black
--                            read from the student's colour
--   platform / username   <- the row
--
-- Rows whose PGN carries none of those headers are left NULL on purpose:
-- readers already fall back to the PGN, and an empty summary would be a claim
-- instead of a fact. Re-running is safe: only NULL summaries are touched.
--
-- Run this in the Supabase SQL Editor after 0016_share_items.sql.

with source as (
  select
    a.id,
    btrim(substring(a.pgn from '\[TimeControl[[:space:]]+"([^"]*)"\]')) as time_control,
    btrim(substring(a.pgn from '\[White[[:space:]]+"([^"]*)"\]')) as white_name,
    btrim(substring(a.pgn from '\[Black[[:space:]]+"([^"]*)"\]')) as black_name,
    btrim(substring(a.pgn from '\[WhiteElo[[:space:]]+"([^"]*)"\]')) as white_elo,
    btrim(substring(a.pgn from '\[BlackElo[[:space:]]+"([^"]*)"\]')) as black_elo,
    case
      when lower(coalesce(a.player_color, '')) = 'black' then 'black'
      else 'white'
    end as player_color,
    a.platform,
    a.username
  from public.analyses a
  where a.game_summary is null
    and a.pgn is not null
    -- at least one header this backfill can honestly read
    and (
      a.pgn like '%[TimeControl%'
      or a.pgn like '%[WhiteElo%'
      or a.pgn like '%[BlackElo%'
      or a.pgn like '%[White "%'
      or a.pgn like '%[Black "%'
    )
),
scored as (
  select
    source.*,
    case
      when source.time_control is null or source.time_control = ''
        or source.time_control in ('-', '?') then null
      -- "300" or "300+3" (Lichess/Chess.com): base + 40s per increment second,
      -- the same 40x weighting Lichess uses to name a time control's speed.
      when source.time_control ~ '^[0-9]+(\+[0-9]+(\.[0-9]+)?)?$' then
        split_part(source.time_control, '+', 1)::numeric
        + 40 * coalesce(nullif(split_part(source.time_control, '+', 2), ''), '0')::numeric
      -- "1/259200" days per move, or "40/7200" moves per seconds.
      when source.time_control ~ '^[0-9]+/[0-9]+(\.[0-9]+)?$' then
        split_part(source.time_control, '/', 2)::numeric
      else null
    end as total_seconds
  from source
)
update public.analyses as analyses
   set game_summary = jsonb_strip_nulls(
     jsonb_build_object(
       'speed',
       case
         when scored.total_seconds is null then 'unknown'
         when scored.time_control ~ '^[0-9]+/[0-9]+' and scored.total_seconds >= 86400
           then 'correspondence'
         when scored.total_seconds < 180 then 'bullet'
         when scored.total_seconds < 600 then 'blitz'
         when scored.total_seconds < 1800 then 'rapid'
         else 'classical'
       end,
       'time_control', nullif(scored.time_control, ''),
       'username', nullif(scored.username, ''),
       'platform',
         nullif(lower(nullif(scored.platform, '')), ''),
       'player_elo',
       case
         when scored.player_color = 'white' and scored.white_elo ~ '^[0-9]+$'
           then scored.white_elo::int
         when scored.player_color = 'black' and scored.black_elo ~ '^[0-9]+$'
           then scored.black_elo::int
         else null
       end,
       'opponent_name',
       nullif(
         nullif(
           case
             when scored.player_color = 'white' then scored.black_name
             else scored.white_name
           end,
           ''
         ),
         -- "?" is the PGN placeholder for an unknown name; telemetry.py's
         -- _clean() drops it too, so the backfill must not store it either.
         '?'
       ),
       'opponent_elo',
       case
         when scored.player_color = 'white' and scored.black_elo ~ '^[0-9]+$'
           then scored.black_elo::int
         when scored.player_color = 'black' and scored.white_elo ~ '^[0-9]+$'
           then scored.white_elo::int
         else null
       end
     )
   )
  from scored
 where analyses.id = scored.id;
