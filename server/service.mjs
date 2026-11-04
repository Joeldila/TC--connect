import {authenticated,publicUser} from './security.mjs';
import {canScope,canModule,canTicket,canAssign,isManager,isStaff} from './access.mjs';
export function createService(env,config,extra){
const db = () => { if (!env.DB)
    throw new Error('Database unavailable'); return env.DB; };
const all = async (sql, ...args) => (await db().prepare(sql).bind(...args).all()).results;
const one = async (sql, ...args) => db().prepare(sql).bind(...args).first();
const run = async (sql, ...args) => db().prepare(sql).bind(...args).run();
const id = () => crypto.randomUUID(), now = () => new Date().toISOString();
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function str(v, max = 200) { if (typeof v !== 'string' || !v.trim() || v.length > max)
    fail('Please complete all required fields within their length limits.'); return v.trim(); }
const choose = (v, allowed) => allowed.includes(v) ? v : fail('Invalid option');
const audit = async (u, a) => run('INSERT INTO audit VALUES (?,?,?,?)', id(), u.id, a, now());
async function actor(req) { const u = await authenticated(env.DB, req, config.production); return { u, identity: null }; }
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
async function roomAccess(u, room, gs) {
    const [kind, rid] = room.split(':');
    if (!u || u.status !== 'active' || u.must_change_password)
        return false;
    if (kind === 'dm') {
        const t = await one('SELECT * FROM direct_threads WHERE id=?', rid);
        return t && (t.member_a === u.id || t.member_b === u.id);
    }
    if (kind === 'meeting') {
        const m = await one('SELECT * FROM meetings WHERE id=?', rid);
        return m && await extra.canMeeting(u, m, gs);
    }
    if (kind === 'group') {
        const g = gs.find(g => g.id === rid);
        return g && canScope(u, { year_id: g.year_id, group_id: g.id }, gs);
    }
    if (kind === 'module') {
        const m = await one('SELECT * FROM modules WHERE id=?', rid);
        return m && canModule(u, m, gs);
    }
    if (kind === 'ticket') {
        const t = await one('SELECT * FROM tickets WHERE id=?', rid);
        return t && canTicket(u, t);
    }
    return false;
}
async function GET(req) {
    try {
        const { u, identity } = await actor(req);
        const gs = await all('SELECT * FROM groups ORDER BY name');
        const ys = await all('SELECT * FROM years ORDER BY name');
        const url = new URL(req.url);
        if (u?.must_change_password && [...url.searchParams].length)
            fail('Change your temporary password first.', 403);
        const room = url.searchParams.get('room'), file = url.searchParams.get('file');
        if (room) {
            if (!u || !await roomAccess(u, room, gs))
                fail('This conversation is restricted.', 403);
            return json(await all('SELECT m.*,u.name AS author_name,u.role AS author_role,u.avatar AS author_avatar,u.extension AS author_extension,u.student_no AS author_student_no,u.group_id AS author_group_id,g.name AS author_group_name,y.name AS author_year FROM (SELECT * FROM messages WHERE room=? ORDER BY created_at DESC LIMIT 500) m JOIN users u ON u.id=m.author_id LEFT JOIN groups g ON g.id=u.group_id LEFT JOIN years y ON y.id=g.year_id ORDER BY m.created_at ASC', room));
        }
        if (file) {
            if (!u)
                fail('Restricted', 403);
            const r = await one('SELECT * FROM resources WHERE id=?', file);
            if (!r)
                fail('File not found', 404);
            const m = await one('SELECT * FROM modules WHERE id=?', r.module_id);
            if (!canModule(u, m, gs))
                fail('Restricted', 403);
            const object = await env.BUCKET.get(r.key);
            if (!object)
                fail('File not found', 404);
            return new Response(object.body, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${r.name.replace(/[^a-zA-Z0-9._ -]/g, '_')}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } });
        }
        if (!u || u.status !== 'active' || u.must_change_password)
            return json({ user: publicUser(u), years: ys, groups: gs, auth: true, localMode:!!config.localMode });
        const ms = (await all('SELECT m.*,u.name AS lecturer_name FROM modules m JOIN users u ON u.id=m.lecturer_id ORDER BY m.name')).filter(m => canModule(u, m, gs));
        const anns = (await all('SELECT a.*,u.name AS author_name,u.role AS author_role FROM announcements a JOIN users u ON u.id=a.author_id ORDER BY created_at DESC')).filter(a => canScope(u, a, gs));
        const ts = (await all('SELECT t.*,u.name AS owner_name,u.student_no AS owner_student_no,u.avatar AS owner_avatar,u.extension AS owner_extension,g.name AS owner_group_name,y.name AS owner_year,s.name AS assignee_name FROM tickets t JOIN users u ON u.id=t.owner_id LEFT JOIN users s ON s.id=t.assignee_id LEFT JOIN groups g ON g.id=u.group_id LEFT JOIN years y ON y.id=g.year_id ORDER BY t.updated_at DESC')).filter(t => canTicket(u, t));
        const rs = (await all('SELECT * FROM resources ORDER BY created_at DESC')).filter(r => ms.some(m => m.id === r.module_id));
        const people = (isManager(u) ? await all('SELECT * FROM users ORDER BY created_at DESC') : await all("SELECT id,name,role,group_id,staff_groups,avatar FROM users WHERE status='active' AND role IN ('admin','hod','lecturer','technician','elearning','student_services')")).map(publicUser);
        const reads = await all('SELECT announcement_id FROM receipts WHERE user_id=?', u.id);
        const receiptCounts = isStaff(u) ? await all('SELECT announcement_id,COUNT(*) AS count FROM receipts GROUP BY announcement_id') : [];
        return json({ user: publicUser(u),localMode:!!config.localMode, ...(await extra.state(u, gs)), years: ys, groups: gs.filter(g => canScope(u, { year_id: g.year_id, group_id: g.id }, gs)), modules: ms, announcements: anns, tickets: ts, resources: rs, people, reads: reads.map(r => r.announcement_id), receiptCounts, links: await all('SELECT * FROM links ORDER BY name'), invites: isManager(u) ? await all('SELECT * FROM invites') : [], audit: isManager(u) ? await all('SELECT a.*,u.name AS name FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 80') : [] });
    }
    catch (e) {
        console.error(e.status ? e.message : e);
        return json({ error: e.status ? e.message : 'The service could not load. Please try again.' }, e.status || 500);
    }
}
async function POST(req) {
    try {
        const origin = req.headers.get('origin');
        if (origin && origin !== new URL(req.url).origin)
            fail('Invalid request origin', 403);
        const { u, identity } = await actor(req);
        if (!u || u.status !== 'active' || u.must_change_password)
            fail('Your account must be active and your temporary password changed.', 403);
        if (req.headers.get('content-type')?.includes('multipart/form-data')) {
            if (!u || u.status !== 'active')
                fail('Restricted', 403);
            const form = await req.formData();
            const moduleId = String(form.get('moduleId') || '');
            const m = await one('SELECT * FROM modules WHERE id=?', moduleId);
            if (!m || !(isManager(u) || (u.role === 'lecturer' && m.lecturer_id === u.id)))
                fail('Only the assigned lecturer can upload here.', 403);
            const file = form.get('file');
            if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024)
                fail('Choose a file up to 10 MB.');
            if (!/\.(pdf|docx|xlsx|pptx|txt|csv|zip|png|jpe?g)$/i.test(file.name))
                fail('Supported: PDF, Office documents, text, CSV, ZIP and images.');
            const key = id();
            await env.BUCKET.put(key, file.stream());
            try {
                await run('INSERT INTO resources VALUES (?,?,?,?,?,?,?)', key, moduleId, file.name.slice(0, 180), key, file.size, u.id, now());
            }
            catch (e) {
                await env.BUCKET.delete(key);
                throw e;
            }
            await audit(u, 'Uploaded module resource: ' + file.name);
            return json({ ok: true });
        }
        const b = await req.json();
        const action = str(b.action, 50);
        const gs = await all('SELECT * FROM groups');
        if (!u || u.status !== 'active')
            fail('Your account needs approval.', 403);
        const manager = () => { if (!isManager(u))
            fail('Administrator access required.', 403); };
        const scope = () => { const gid = b.groupId || null; const g = gs.find(g => g.id === gid); const y = gid ? g?.year_id : b.yearId || null; if (gid && !g)
            fail('Invalid group'); return { year_id: y, group_id: gid }; };
        switch (action) {
            case 'year': {
                manager();
                await run('INSERT INTO years VALUES (?,?)', id(), str(b.name, 70));
                break;
            }
            case 'group': {
                manager();
                if (!await one('SELECT id FROM years WHERE id=?', b.yearId))
                    fail('Choose a valid year');
                await run('INSERT INTO groups VALUES (?,?,?)', id(), str(b.name, 70), b.yearId);
                break;
            }
            case 'invite': {
                return await extra.createStaff(u, b);
            }
            case 'revokeInvite': {
                manager();
                await run('DELETE FROM invites WHERE email=?', str(b.email, 150).toLowerCase());
                break;
            }
            case 'person': {
                manager();
                const target = await one('SELECT * FROM users WHERE id=?', b.id);
                if (!target)
                    fail('Account not found');
                const owner = await one("SELECT value FROM settings WHERE id='owner'");
                if (target.id === owner.value && (b.role !== 'admin' || b.status !== 'active'))
                    fail('The founding administrator must remain active.');
                const role = choose(b.role, ['admin', 'hod', 'lecturer', 'rep', 'student', 'technician', 'elearning', 'student_services']), status = choose(b.status, ['active', 'pending', 'suspended']);
                if (['rep', 'student'].includes(role) && !gs.some(g => g.id === b.groupId))
                    fail('Students need a valid group.');
                if (u.id === target.id && (role !== u.role || status !== 'active'))
                    fail('Ask another administrator to change your own access.');
                await run('UPDATE users SET role=?,status=?,group_id=?,staff_groups=? WHERE id=?', role, status, b.groupId || null, JSON.stringify((b.staffGroups || []).filter((x) => gs.some(g => g.id === x))), b.id);
                break;
            }
            case 'module': {
                if (!isStaff(u))
                    fail('Staff access required', 403);
                const s = scope();
                if (!s.year_id || !await one('SELECT id FROM years WHERE id=?', s.year_id))
                    fail('Choose a valid year');
                let lecturerId = u.role === 'lecturer' ? u.id : b.lecturerId;
                const l = await one("SELECT * FROM users WHERE id=? AND status='active'", lecturerId);
                if (!l || !isStaff(l))
                    fail('Choose an active lecturer');
                const allowed = JSON.parse(l.staff_groups || '[]');
                if (l.role === 'lecturer' && !(s.group_id ? allowed.includes(s.group_id) : gs.filter(g => g.year_id === s.year_id).length > 0 && gs.filter(g => g.year_id === s.year_id).every(g => allowed.includes(g.id))))
                    fail('The lecturer must be assigned to every group receiving this module.');
                await run('INSERT INTO modules VALUES (?,?,?,?,?,?,?,?)', id(), str(b.code, 30), str(b.name, 120), s.year_id, s.group_id, lecturerId, typeof b.description === 'string' ? b.description.slice(0, 2000) : '', now());
                break;
            }
            case 'announcement': {
                if (!isStaff(u) && u.role !== 'rep')
                    fail('Publishing is restricted to staff and representatives.', 403);
                const s = scope();
                if (s.year_id && !await one('SELECT id FROM years WHERE id=?', s.year_id))
                    fail('Invalid year');
                if (u.role === 'rep' && s.group_id !== u.group_id)
                    fail('Class representatives may publish only to their own group.', 403);
                if (u.role === 'lecturer' && (!canScope(u, s, gs) || (s.year_id && !s.group_id && !gs.filter(g => g.year_id === s.year_id).every(g => JSON.parse(u.staff_groups || '[]').includes(g.id)))))
                    fail('This audience is outside your assigned groups.', 403);
                await run('INSERT INTO announcements VALUES (?,?,?,?,?,?,?,?)', id(), str(b.title, 160), str(b.body, 10000), u.id, s.year_id, s.group_id, choose(b.priority, ['Normal', 'Important', 'Urgent']), now());
                break;
            }
            case 'deleteAnnouncement': {
                const a = await one('SELECT * FROM announcements WHERE id=?', b.id);
                if (!a || !(isManager(u) || a.author_id === u.id))
                    fail('Restricted', 403);
                await db().batch([db().prepare('DELETE FROM receipts WHERE announcement_id=?').bind(b.id), db().prepare('DELETE FROM announcements WHERE id=?').bind(b.id)]);
                break;
            }
            case 'read': {
                const a = await one('SELECT * FROM announcements WHERE id=?', b.id);
                if (!a || !canScope(u, a, gs))
                    fail('Restricted', 403);
                await run('INSERT OR IGNORE INTO receipts VALUES (?,?,?)', id(), b.id, u.id);
                return json({ ok: true });
            }
            case 'ticket': {
                const category = choose(b.category, ['General IT', 'eLearning', 'TCMS', 'Module query', 'Call request']);
                const team = { eLearning: 'elearning', TCMS: 'student_services', 'Module query': 'academic' }[category] || 'technical';
                const cb = b.callbackAt ? new Date(b.callbackAt) : null;
                if (cb && (!Number.isFinite(cb.getTime()) || cb.getTime() <= Date.now()))
                    fail('Choose a future callback time.');
                if (category === 'Call request' && !cb)
                    fail('A call request needs a preferred call time.');
                await run('INSERT INTO tickets (id,number,title,body,category,priority,status,owner_id,assignee_id,group_id,callback_at,phone,resolution,created_at,updated_at,team) SELECT ?,COALESCE(MAX(number),0)+1,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM tickets', id(), str(b.title, 160), str(b.body, 8000), category, choose(b.priority, ['Low', 'Normal', 'High', 'Urgent']), 'Open', u.id, null, u.group_id, cb ? cb.toISOString() : null, u.extension, null, now(), now(), team);
                break;
            }
            case 'updateTicket': {
                const t = await one('SELECT * FROM tickets WHERE id=?', b.id);
                if (!t || !canTicket(u, t))
                    fail('Restricted', 403);
                if (!canAssign(u, t))
                    fail('This queue belongs to another support team.', 403);
                const status = choose(b.status, ['Open', 'In progress', 'Waiting for student', 'Escalated', 'Resolved', 'Closed']);
                const aid = b.assigneeId || null;
                if (aid) {
                    const a = await one('SELECT * FROM users WHERE id=? AND status=?', aid, 'active');
                    if (!a || !canAssign(a, t))
                        fail('Choose a staff member from the responsible team.');
                    if (!isManager(u) && aid !== u.id)
                        fail('Only a manager may reassign to another staff member.', 403);
                }
                const resolution = typeof b.resolution === 'string' ? b.resolution.trim().slice(0, 5000) : '';
                if (['Resolved', 'Closed'].includes(status) && !resolution)
                    fail('Add resolution notes before resolving or closing.');
                await run('UPDATE tickets SET status=?,assignee_id=?,resolution=?,updated_at=? WHERE id=?', status, aid, resolution, now(), t.id);
                break;
            }
            case 'message': {
                const room = str(b.room, 100);
                if (!await roomAccess(u, room, gs))
                    fail('This conversation is restricted.', 403);
                const g = gs.find(g => g.id === u.group_id), y = g ? await one('SELECT name FROM years WHERE id=?', g.year_id) : null;
                const snap = JSON.stringify({ name: u.name, student_no: u.student_no, year: y?.name || null, group: g?.name || null });
                await run('INSERT INTO messages (id,room,author_id,body,created_at,author_snapshot) VALUES (?,?,?,?,?,?)', id(), room, u.id, str(b.body, 5000), now(), snap);
                if (room.startsWith('ticket:'))
                    await run('UPDATE tickets SET updated_at=? WHERE id=?', now(), room.slice(7));
                return json({ ok: true });
            }
            case 'deleteResource': {
                const r = await one('SELECT * FROM resources WHERE id=?', b.id);
                if (!r || !(isManager(u) || r.author_id === u.id))
                    fail('Restricted', 403);
                await env.BUCKET.delete(r.key);
                await run('DELETE FROM resources WHERE id=?', r.id);
                break;
            }
            case 'link': {
                manager();
                const url = new URL(str(b.url, 1000));
                if (url.protocol !== 'https:')
                    fail('Use an HTTPS address.');
                await run('INSERT INTO links VALUES (?,?,?,?)', id(), str(b.name, 80), url.href, typeof b.description === 'string' ? b.description.slice(0, 300) : '');
                break;
            }
            case 'deleteLink': {
                manager();
                await run('DELETE FROM links WHERE id=?', b.id);
                break;
            }
            default: return await extra.action(u, b, gs, roomAccess);
        }
        await audit(u, action + (b.title ? ': ' + b.title : b.name ? ': ' + b.name : ''));
        return json({ ok: true });
    }
    catch (e) {
        console.error(e.status ? e.message : e);
        const conflict = String(e.message).includes('UNIQUE');
        return json({ error: conflict ? 'This record already exists. Please use a unique name, code or email.' : e.status ? e.message : 'The change could not be saved. Please try again.' }, conflict ? 409 : e.status || 500);
    }
}

return {GET,POST,roomAccess};
}
