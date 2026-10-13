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
]
