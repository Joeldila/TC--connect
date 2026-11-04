ALTER TABLE users ADD COLUMN extension TEXT;
UPDATE users SET extension=CAST(610000+rowid AS TEXT) WHERE extension IS NULL;
CREATE UNIQUE INDEX user_extension_unique ON users(extension);
CREATE TRIGGER assign_extension AFTER INSERT ON users WHEN NEW.extension IS NULL BEGIN UPDATE users SET extension=CAST(610000+NEW.rowid AS TEXT) WHERE id=NEW.id; END;
CREATE TABLE voice_calls (id TEXT PRIMARY KEY,caller_id TEXT NOT NULL REFERENCES users(id),callee_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL,created_at TEXT NOT NULL,answered_at TEXT,connected_at TEXT,ended_at TEXT,end_reason TEXT,caller_seen_at TEXT NOT NULL,callee_seen_at TEXT NOT NULL,caller_connected INTEGER NOT NULL DEFAULT 0,callee_connected INTEGER NOT NULL DEFAULT 0,CHECK(caller_id<>callee_id));
CREATE TABLE call_locks (user_id TEXT PRIMARY KEY REFERENCES users(id),call_id TEXT NOT NULL REFERENCES voice_calls(id));
CREATE TABLE call_signals (seq INTEGER PRIMARY KEY AUTOINCREMENT,call_id TEXT NOT NULL REFERENCES voice_calls(id),sender_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX signals_by_call ON call_signals(call_id,seq);
CREATE INDEX calls_caller ON voice_calls(caller_id,created_at);
CREATE INDEX calls_callee ON voice_calls(callee_id,created_at);
CREATE TABLE user_presence (user_id TEXT PRIMARY KEY REFERENCES users(id),last_seen_at TEXT NOT NULL);

INSERT INTO links (id,name,url,description) SELECT 'tc-elearning-default','TC eLearning','https://elearning.triumphant.edu.na/course/search.php','Course search and online learning at Triumphant College.' WHERE NOT EXISTS (SELECT 1 FROM links WHERE url LIKE 'https://elearning.triumphant.edu.na/%');
INSERT INTO links (id,name,url,description) SELECT 'tc-tcms-default','TCMS Student Portal','https://www.tcmsnam.org/apex/f?p=111:LOGIN_DESKTOP','Open the TCMS student portal using your college account.' WHERE NOT EXISTS (SELECT 1 FROM links WHERE url LIKE 'https://www.tcmsnam.org/%');
