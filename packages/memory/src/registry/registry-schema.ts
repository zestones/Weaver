// One entry per version of the schema, in order. An entry is never edited once a registry may hold it, and a change
// of schema is a new entry that keeps every row: what the owner decided must survive it.
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE cards (
    number INTEGER PRIMARY KEY,
    state TEXT NOT NULL,
    origin TEXT NOT NULL,
    session TEXT,
    unit INTEGER,
    call_id TEXT UNIQUE,
    review_key TEXT,
    attempts INTEGER NOT NULL,
    record TEXT NOT NULL
  ) STRICT;
  CREATE INDEX cards_by_state ON cards (state);
  CREATE INDEX cards_by_session ON cards (session, unit);
  CREATE INDEX cards_by_review_key ON cards (review_key);

  CREATE TABLE card_files (
    card INTEGER NOT NULL REFERENCES cards (number),
    file TEXT NOT NULL,
    PRIMARY KEY (card, file)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX card_files_by_file ON card_files (file);

  CREATE TABLE card_labels (
    card INTEGER NOT NULL REFERENCES cards (number),
    label TEXT NOT NULL,
    PRIMARY KEY (card, label)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX card_labels_by_label ON card_labels (label);

  CREATE TABLE review_points (
    name TEXT PRIMARY KEY,
    card INTEGER NOT NULL REFERENCES cards (number)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE writer_turn (
    slot INTEGER PRIMARY KEY CHECK (slot = 1),
    pid INTEGER NOT NULL
  ) STRICT;
  `,
  // A card can be written on once it exists: every card made before starts with no note.
  `
  UPDATE cards SET record = json_set(record, '$.notes', json('[]'));
  `,
  `
  CREATE TABLE card_commands (id TEXT PRIMARY KEY, words TEXT NOT NULL, actor TEXT NOT NULL, claimed INTEGER NOT NULL DEFAULT 0) STRICT;
  CREATE TABLE proposal_views (card INTEGER PRIMARY KEY, proposal TEXT NOT NULL) STRICT;
  CREATE TABLE issue_filings (id INTEGER PRIMARY KEY, card INTEGER NOT NULL, record TEXT NOT NULL) STRICT;
  UPDATE cards SET record = json_set(record,
    '$.notes', json((SELECT json_group_array(json_set(value, '$.id', 'note-' || (key + 1))) FROM json_each(record, '$.notes'))),
    '$.lifecycle', json_object(
      'revision', json_array_length(record, '$.history'),
      'cycle', (SELECT count(*) FROM json_each(record, '$.history') WHERE json_extract(value, '$.action') = 'reopened'),
      'noteStart', (SELECT count(*) FROM json_each(record, '$.history') WHERE json_extract(value, '$.action') = 'noted'
        AND key < COALESCE((SELECT max(key) FROM json_each(record, '$.history') WHERE json_extract(value, '$.action') = 'reopened'), -1)),
      'stage', 'uninvestigated'),
    '$.revisions', CASE WHEN json_type(record, '$.written') = 'object'
      THEN json_array(json_object('revision', json_array_length(record, '$.history'),
        'before', NULL, 'after', json_extract(record, '$.written'), 'by', NULL,
        'reason', 'Migration baseline; earlier overwritten content is unavailable'))
      ELSE json('[]') END);
  WITH conclusions AS (
    SELECT number, COALESCE(
      (SELECT json_extract(value, '$.conclusion') FROM json_each(record, '$.notes')
        WHERE key >= json_extract(record, '$.lifecycle.noteStart') AND json_type(value, '$.conclusion') = 'text'
        ORDER BY key DESC LIMIT 1),
      CASE WHEN json_extract(record, '$.lifecycle.cycle') = 0 AND json_extract(record, '$.flag.fields.did') = 'fixed' THEN 'fixed' END
    ) AS latest FROM cards
  )
  UPDATE cards SET record = json_set(record, '$.lifecycle.stage',
    CASE (SELECT latest FROM conclusions WHERE conclusions.number = cards.number)
      WHEN 'fixed' THEN 'fixed' WHEN 'refuted' THEN 'refuted' WHEN 'needs-owner' THEN 'needs-owner'
      WHEN 'confirmed' THEN 'investigated' WHEN 'unsure' THEN 'investigated' ELSE 'uninvestigated' END);
  `,
]
