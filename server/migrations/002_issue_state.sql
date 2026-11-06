-- ingested_at doubles as "last seen in a search crawl"; the post-ingest sweep re-checks
-- open issues whose ingested_at predates the run, and marks them closed or delisted.
--   open      still open with a target label
--   closed    closed, deleted, transferred or otherwise gone on GitHub
--   delisted  still open on GitHub but no longer carries any target label
ALTER TABLE issues
  ADD CONSTRAINT issues_state_check CHECK (state IN ('open', 'closed', 'delisted'));

CREATE INDEX issues_open_last_seen_idx ON issues (ingested_at) WHERE state = 'open';
