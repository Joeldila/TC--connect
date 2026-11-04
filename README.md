# TC Connect 4.0 — complete voice and teaching project

Start with **00-READ-ME.html**. It contains both the local testing procedure and the Railway deployment procedure in one place.

## Windows local testing

1. Install Node.js 24 or newer.
2. Extract TC-Connect-Voice-v4.zip completely.
3. Double-click **01-FIRST-RUN.cmd** with internet access once. It installs dependencies, builds the UI, checks its assets, and starts the backend. Installation/build logs are in `logs`.
4. Create your administrator in the browser page that opens.
5. For future runs, double-click **02-START.cmd**. Keep the launcher window open.

The backend runs only on the computer's loopback interface. Accounts, photos, documents and messages are saved in `local-data`. Back up the entire directory while the app is stopped. Core workflows work offline after the first dependency installation; actual multi-person video needs LiveKit and internet.

## Project contents

- `src`: React/TypeScript application interface and live lesson UI.
- `server`: Node backend, sessions, password hashing, permissions, SQLite migrations, protected file storage and LiveKit control integration.
- `scripts`: loopback startup, one-time administrator setup, prerequisites and account recovery.
- `public` and `dist`: static source assets and the complete prebuilt interface.
- `tests`: real HTTP/local-startup integration, system workflows and platform path checks.
- `01-FIRST-RUN.cmd`, `02-START.cmd`: numbered Windows launchers.
- `Dockerfile`, `railway.json`, `.env.example`: Railway build/deployment configuration and variable checklist.
- `.env.local.example`: optional online-meeting settings for local testing.

No passwords, user data or cloud credentials are included. Runtime dependencies are installed for your computer by the first-run launcher; node_modules and a Node installer are not bundled.

## Implemented workflows

Student registration/approval; admin-created staff accounts with mandatory first-use password replacement; HOD, lecturer, representative, student, technician, eLearning support and student-services roles; years/groups and lecturer assignments; restricted modules/files/discussions; scoped announcements and acknowledgements; editable profiles/photos; automatic full-name/student-number/year/group/photo message headers; authorised profile viewing; private two-person conversations; service queues with correct responsibility, assignment, replies, callback logs, escalation and resolution; schedules and saved lesson discussions; conferencing integration with host approval, cameras/microphones, presentations through screen sharing, participant moderation and verified attendance CSV.

The Local device checks page has been removed. Camera/microphone and presentation controls remain in actual live sessions. Actual video conferences use the configured LiveKit media service. There is no recording, captions, breakout rooms, PSTN calling or automated TCMS/eLearning record sync. Directory links open the existing platforms.

Private chats are readable only by their two members. Academic role/year/group/module access is enforced on the backend. A student's own profile edits cannot change their verified student number, year/group or role. Author identity is read from registered records, not accepted from message text. Messages retain a registration snapshot when sent; the current profile is also shown.

## Corrections in this package

The earlier static-file guard compared Windows paths using a literal forward-slash prefix. This could deny JavaScript and CSS while allowing the HTML shell to load. `server/assets.mjs` now uses platform path operations and is tested with Windows drive paths/folders containing spaces and Linux deployment paths. Traversal remains denied.

Local setup retains the corrected same-origin referrer policy, browser request metadata checks and its one-time setup token. Normal browser submissions can finish setup; explicit foreign origins and invalid tokens remain rejected.

A visible startup fallback, asset-load error reporting, React error boundary and prerequisite/asset validation make failures diagnosable. Opening source index.html directly displays instructions rather than an empty div.

## Railway

Follow section 6 of 00-READ-ME.html. Deploy the root of this folder, attach a `/data` volume, use one replica, set the listed secrets/variables, and configure the generated public HTTPS origin as APP_URL. Railway supplies PORT. The Dockerfile builds the interface and starts `server/index.mjs`. `/health` is the health check. SQLite migrations run at application startup when the volume is mounted.

Local and Railway databases are separate. No local test records are uploaded automatically. Enable consistent volume backups and test restores. Do not copy only the live SQLite main file while WAL writes may be outstanding; back up the entire stopped data directory or a consistent volume snapshot.

## Developer commands and validation

- `npm ci`
- `npm run check`
- `npm test`
- `npm run build`
- `npm run local` for the developer equivalent of the local launcher
- `npm start` for the configured hosted server

Local tests use real HTTP setup/sign-in, the real database, password hashing, file conversion and restart persistence. The system suite covers role constraints, cross-year files/notices/messages, private chats, profiles, queues, meeting admission/token permissions/moderation and attendance. Media-service control is tested using a service double; a live multi-person conference still needs verification against your account and devices. Docker/Railway and the Windows command scripts are supplied but were not executed on a Windows/Railway account in this Linux build environment. Windows filesystem semantics are covered explicitly by tests. Do not treat this as a whole-college load-test or an independent security audit.

The interface has been enlarged for readable text, touch-sized controls, mobile navigation, scrollable messages/tables/dialogs and responsive layouts. The sign-in/register page includes a slow decorative cover animation, CSS 3D glass card, the requested I GOT YOU COVERED / JUST REGISTER or SIGN IN statement, and a word-by-word TC - Enabling individual for empowerment line. Animations respect reduced-motion settings and do not block fields.

The app shows the latest 500 messages per conversation; older rows remain stored. Invite emails, self-service email verification/password recovery and recording services are not configured. Admins issue temporary passwords through People & access. For founding-admin recovery, an authorised machine/service operator can run `npm run reset-admin` with DATA_DIR, RESET_EMAIL and RESET_PASSWORD securely configured, then remove reset values.

Primary documentation: https://docs.railway.com/volumes ; https://docs.livekit.io/reference/components/react/ ; https://docs.livekit.io/home/server/generating-tokens

## Private voice calls

Users receive an extension automatically on registration/staff creation. Existing users receive one through migration 003. Extensions are linked to registered profiles and are not mobile/PSTN numbers. Request cards, authorised profiles and the Calls directory can start a two-person voice call. Calls use microphone-only WebRTC, not WhatsApp, tel: links or a mobile dialler. Echo cancellation, noise suppression and automatic gain control are requested from the browser.

The lifecycle includes ringing, answer/decline, connecting, active after both peers confirm transport, mute, hang-up, timeout, busy protection, missed/declined/ended history and connection failure. A server-sent event channel notifies only the caller and recipient. Signaling payloads and call history are authorised against those exact participants, including when the requesting account is an administrator. SDP/ICE is not placed in the operation audit log. Signaling is retained temporarily for negotiation and purged after calls end. Audio is not recorded by the app.

The recipient must have TC Connect open and signed in. Enable incoming call sounds once per browser session, then permit the microphone when starting or answering. Browsers may require a separate Play caller audio click if playback is blocked. Browser/OS volume and network quality still determine audible output.

For same-computer loopback testing, local mode can use host ICE candidates with no external service. For internet deployment, configure TURN_URLS and either TURN_SECRET or TURN_USERNAME/TURN_PASSWORD. TURN_SECRET generates temporary HMAC credentials; the secret itself is not sent to clients. Static credentials supplied by a provider are exposed only to authorised call participants because the browser needs them to use that relay. Optional STUN_URLS can be configured; no public STUN provider is contacted by default. A Railway web container is not a TURN service. HTTPS is required for hosted microphone access. The local launcher uses a loopback origin.

A real WebRTC trial was attempted using two synthetic browser audio streams, the application's actual AudioConnection engine and real signaling endpoints. SDP negotiation completed, but the cloud browser supplied no ICE candidates and a media connection could not be established there without a relay. Do not describe that attempt as a successful human speech call. Backend lifecycle, targeted notifications, cross-user denials and relay credential handling are tested. Verify actual two-device speech using your intended TURN provider/network. No TURN or LiveKit account credentials were supplied, and a live multi-person lesson was not verified against a college media account.

Portal defaults are inserted for the supplied Triumphant eLearning and TCMS URLs. Their icon is selected automatically from the hostname/name using bundled code-native icons. The TCMS link omits the fixed APEX session identifier from the pasted example so the portal can establish a fresh session. These are recognisable application icons, not downloaded official logo files. Existing external platform sign-in/records remain in those services.

## Call configuration and testing

Use separate browser profiles/browsers for two signed-in accounts. On a single computer use headphones and avoid two open loudspeakers. From a student request, responsible staff can Dial the requester; the requester can Dial assigned staff. Authorised profile views have Dial and Private chat actions. Unrelated students cannot resolve or call each other merely by guessing extensions.

Automated call tests validate private histories/signaling, absence of third-user SSE notifications, duplicate/busy protection, offers/answers/cursors, connected-state confirmation by both peers, hang-up/decline/timeouts/logout cleanup, role relationships, production relay requirements and temporary TURN credentials. Audio quality and device permissions require a real user trial.
