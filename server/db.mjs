import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
export function openDatabase(directory){
 mkdirSync(directory,{recursive:true});const sql=new DatabaseSync(join(directory,'tc-connect.sqlite'));sql.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
 sql.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY)');
 for(const name of ['001_base.sql','002_identity_meetings.sql','003_private_calls.sql']){if(!sql.prepare('SELECT name FROM migrations WHERE name=?').get(name)){sql.exec('BEGIN');try{sql.exec(readFileSync(new URL('./'+name,import.meta.url),'utf8'));sql.prepare('INSERT INTO migrations VALUES (?)').run(name);sql.exec('COMMIT')}catch(e){sql.exec('ROLLBACK');throw e}}}
 const api={prepare(query){let args=[];const stmt={bind(...values){args=values;return stmt},first(){return sql.prepare(query).get(...args)||null},all(){return {results:sql.prepare(query).all(...args)}},run(){return sql.prepare(query).run(...args)}};return stmt},async batch(stmts){sql.exec('BEGIN');try{const r=[];for(const s of stmts)r.push(s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}},sql,close(){sql.close()}};return api;
}
