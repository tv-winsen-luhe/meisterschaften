-- Dev seed — a realistic championship field for the LOCAL D1 only. Run via `pnpm db:seed`.
-- NOT a migration (lives outside worker/migrations, never runs against --remote): it is dev
-- fixture data, applied with `wrangler d1 execute … --local --file`.
--
-- Idempotent: it first clears the runtime tables (matches → draws → registrations, in FK-safe
-- order) and pins the phase back to `signup`, then inserts a fresh field across all three
-- competitions. Re-running it always lands the same state, regardless of what was there before.
--
-- The field models a plausible club championship between TV Winsen and TSV Winsen:
--   • mens             — 16 confirmed + 3 new + 1 cancelled   (LK 6–19, one no-id at 25.0)
--   • womens           — 10 confirmed + 2 new + 1 cancelled   (LK 8–20, one no-id at 25.0)
--   • mens-challenger  — 12 confirmed + 1 new + 1 cancelled   (all LK ≥ 20, the protected cap)
-- LK scale runs 1.0 (strongest) → 25.0 (weakest); confirmed rows linked to a nuLiga `player_id`
-- carry their derived LK, no-id confirms seed at DEFAULT_LK 25.0, and `new` rows have no LK yet
-- (it is derived at confirm). Challenger entries stay LK ≥ 20 so the field is drawable.

-- ── Reset to a clean signup phase ──────────────────────────────────────────────────────────────
DELETE FROM matches;
DELETE FROM draws;
DELETE FROM registrations;
-- Stable, reproducible ids: restart every autoincrement so a re-seed always yields the same rows.
DELETE FROM sqlite_sequence WHERE name IN ('registrations', 'draws', 'matches');
INSERT INTO app_state (id, phase) VALUES (1, 'signup')
  ON CONFLICT(id) DO UPDATE SET phase = 'signup';

-- ── mens ───────────────────────────────────────────────────────────────────────────────────────
INSERT INTO registrations
  (created_at, updated_at, competition, first_name, last_name, club, email, phone, note, player_id, lk, status)
VALUES
  ('2026-06-05T18:12:00.000Z', '2026-06-06T09:30:00.000Z', 'mens', 'Lukas',       'Brandt',   'TV Winsen',  'lukas.brandt@gmx.de',          '+49 151 2345671', NULL,                                  '40021547', '6.2',  'confirmed'),
  ('2026-06-05T19:44:00.000Z', '2026-06-06T09:31:00.000Z', 'mens', 'Jonas',       'Krüger',   'TSV Winsen', 'jonas.krueger@web.de',         '+49 170 5512384', NULL,                                  '40021903', '7.5',  'confirmed'),
  ('2026-06-06T08:03:00.000Z', '2026-06-07T11:05:00.000Z', 'mens', 'Maximilian',  'Voss',     'TV Winsen',  'max.voss@gmail.com',           '+49 152 8841220', NULL,                                  '40022118', '8.1',  'confirmed'),
  ('2026-06-06T20:21:00.000Z', '2026-06-07T11:06:00.000Z', 'mens', 'Tobias',      'Wagner',   'TSV Winsen', 'tobias.wagner@t-online.de',    '+49 160 7732015', NULL,                                  '40022540', '9.0',  'confirmed'),
  ('2026-06-07T09:55:00.000Z', '2026-06-08T08:40:00.000Z', 'mens', 'Felix',       'Hartmann', 'TV Winsen',  'felix.hartmann@gmx.de',        '+49 151 9087443', 'Kann freitags erst ab 18 Uhr.',       '40022761', '9.8',  'confirmed'),
  ('2026-06-07T17:30:00.000Z', '2026-06-08T08:41:00.000Z', 'mens', 'Niklas',      'Schröder', 'TSV Winsen', 'niklas.schroeder@web.de',      '+49 172 3344190', NULL,                                  '40023004', '10.4', 'confirmed'),
  ('2026-06-08T12:18:00.000Z', '2026-06-09T19:12:00.000Z', 'mens', 'David',       'Köhler',   'TV Winsen',  'david.koehler@gmail.com',      '+49 151 4456720', NULL,                                  '40023288', '11.2', 'confirmed'),
  ('2026-06-09T10:42:00.000Z', '2026-06-10T07:55:00.000Z', 'mens', 'Philipp',     'Lang',     'TV Winsen',  'philipp.lang@gmx.de',          NULL,              NULL,                                  '40023511', '12.0', 'confirmed'),
  ('2026-06-09T21:07:00.000Z', '2026-06-10T07:56:00.000Z', 'mens', 'Sebastian',   'Otto',     'TSV Winsen', 'sebastian.otto@t-online.de',   '+49 160 2218905', NULL,                                  '40023742', '12.7', 'confirmed'),
  ('2026-06-10T13:25:00.000Z', '2026-06-11T16:20:00.000Z', 'mens', 'Christian',   'Walter',   'TV Winsen',  'christian.walter@web.de',      '+49 151 6678231', NULL,                                  '40024019', '13.5', 'confirmed'),
  ('2026-06-11T08:50:00.000Z', '2026-06-12T09:14:00.000Z', 'mens', 'Daniel',      'Sommer',   'TSV Winsen', 'daniel.sommer@gmail.com',      '+49 170 9923400', NULL,                                  '40024333', '14.3', 'confirmed'),
  ('2026-06-12T19:36:00.000Z', '2026-06-13T10:02:00.000Z', 'mens', 'Marvin',      'Busch',    'TV Winsen',  'marvin.busch@gmx.de',          '+49 152 1145678', NULL,                                  '40024607', '15.1', 'confirmed'),
  ('2026-06-13T14:11:00.000Z', '2026-06-14T18:48:00.000Z', 'mens', 'Florian',     'Keller',   'TSV Winsen', 'florian.keller@web.de',        '+49 151 3390821', NULL,                                  '40024890', '16.0', 'confirmed'),
  ('2026-06-15T09:28:00.000Z', '2026-06-16T08:33:00.000Z', 'mens', 'Andreas',     'Böhm',     'TV Winsen',  'andreas.boehm@t-online.de',    '+49 160 5567012', 'Spiele am liebsten vormittags.',      '40025164', '17.4', 'confirmed'),
  ('2026-06-16T20:05:00.000Z', '2026-06-17T19:40:00.000Z', 'mens', 'Stefan',      'Vogel',    'TSV Winsen', 'stefan.vogel@gmail.com',       '+49 151 7781203', NULL,                                  '40025438', '18.6', 'confirmed'),
  -- No-id confirm: seeds at DEFAULT_LK (25.0), player_id null.
  ('2026-06-18T11:47:00.000Z', '2026-06-19T09:10:00.000Z', 'mens', 'Kevin',       'Pohl',     'TV Winsen',  'kevin.pohl@gmx.de',            '+49 172 6610934', 'Keine nuLiga-ID, bin Neumitglied.',   NULL,       '25.0', 'confirmed'),
  -- new: just signed up, not yet confirmed → no player_id, no LK.
  ('2026-06-22T18:33:00.000Z', '2026-06-22T18:33:00.000Z', 'mens', 'Tim',         'Engel',    'TSV Winsen', 'tim.engel@web.de',             '+49 151 2240897', NULL,                                  NULL,       NULL,   'new'),
  ('2026-06-24T07:19:00.000Z', '2026-06-24T07:19:00.000Z', 'mens', 'Patrick',     'Frey',     'TV Winsen',  'patrick.frey@gmail.com',       '+49 160 8834120', NULL,                                  NULL,       NULL,   'new'),
  ('2026-06-27T21:52:00.000Z', '2026-06-27T21:52:00.000Z', 'mens', 'Marco',       'Sander',   'TSV Winsen', 'marco.sander@gmx.de',          NULL,              NULL,                                  NULL,       NULL,   'new'),
  -- cancelled: withdrew after confirming.
  ('2026-06-10T09:14:00.000Z', '2026-06-20T15:26:00.000Z', 'mens', 'Oliver',      'Reuter',   'TV Winsen',  'oliver.reuter@t-online.de',    '+49 151 5523107', NULL,                                  '40024225', '14.9', 'cancelled');

-- ── womens ───────────────────────────────────────────────────────────────────────────────────────
INSERT INTO registrations
  (created_at, updated_at, competition, first_name, last_name, club, email, phone, note, player_id, lk, status)
VALUES
  ('2026-06-05T20:08:00.000Z', '2026-06-06T10:12:00.000Z', 'womens', 'Laura',     'Schmidt',   'TV Winsen',  'laura.schmidt@gmx.de',        '+49 151 3312984', NULL,                                  '40031142', '8.3',  'confirmed'),
  ('2026-06-06T18:39:00.000Z', '2026-06-07T09:48:00.000Z', 'womens', 'Anna',      'Becker',    'TSV Winsen', 'anna.becker@web.de',          '+49 170 4421560', NULL,                                  '40031408', '9.7',  'confirmed'),
  ('2026-06-07T13:52:00.000Z', '2026-06-08T11:30:00.000Z', 'womens', 'Sophie',    'Wolf',      'TV Winsen',  'sophie.wolf@gmail.com',       '+49 152 6678390', NULL,                                  '40031677', '11.0', 'confirmed'),
  ('2026-06-08T19:14:00.000Z', '2026-06-09T08:22:00.000Z', 'womens', 'Marie',     'Hoffmann',  'TSV Winsen', 'marie.hoffmann@t-online.de',  '+49 160 1190245', NULL,                                  '40031905', '12.4', 'confirmed'),
  ('2026-06-09T16:47:00.000Z', '2026-06-10T18:05:00.000Z', 'womens', 'Lena',      'Richter',   'TV Winsen',  'lena.richter@gmx.de',         '+49 151 8845013', 'Bin im Urlaub bis 12.06.',            '40032188', '13.8', 'confirmed'),
  ('2026-06-11T11:03:00.000Z', '2026-06-12T07:41:00.000Z', 'womens', 'Julia',     'Neumann',   'TSV Winsen', 'julia.neumann@web.de',        '+49 172 5523109', NULL,                                  '40032454', '15.2', 'confirmed'),
  ('2026-06-13T09:36:00.000Z', '2026-06-14T10:18:00.000Z', 'womens', 'Katharina', 'Fuchs',     'TV Winsen',  'katharina.fuchs@gmail.com',   '+49 151 9087662', NULL,                                  '40032730', '16.9', 'confirmed'),
  ('2026-06-15T20:22:00.000Z', '2026-06-16T09:55:00.000Z', 'womens', 'Nina',      'Albrecht',  'TSV Winsen', 'nina.albrecht@gmx.de',        '+49 160 3340987', NULL,                                  '40033012', '18.1', 'confirmed'),
  ('2026-06-17T14:50:00.000Z', '2026-06-18T16:33:00.000Z', 'womens', 'Sarah',     'Lorenz',    'TV Winsen',  'sarah.lorenz@t-online.de',    NULL,              NULL,                                  '40033289', '19.5', 'confirmed'),
  -- No-id confirm: seeds at DEFAULT_LK (25.0).
  ('2026-06-19T18:11:00.000Z', '2026-06-20T08:47:00.000Z', 'womens', 'Melanie',   'Götz',      'TSV Winsen', 'melanie.goetz@web.de',        '+49 151 2218043', 'Spiele zum ersten Mal mit.',          NULL,       '25.0', 'confirmed'),
  -- new
  ('2026-06-23T19:28:00.000Z', '2026-06-23T19:28:00.000Z', 'womens', 'Jana',      'Seibert',   'TV Winsen',  'jana.seibert@gmail.com',      '+49 170 6612385', NULL,                                  NULL,       NULL,   'new'),
  ('2026-06-26T08:44:00.000Z', '2026-06-26T08:44:00.000Z', 'womens', 'Christina', 'Mohr',      'TSV Winsen', 'christina.mohr@gmx.de',       '+49 152 4498120', NULL,                                  NULL,       NULL,   'new'),
  -- cancelled
  ('2026-06-12T10:05:00.000Z', '2026-06-21T13:12:00.000Z', 'womens', 'Vanessa',   'Arnold',    'TV Winsen',  'vanessa.arnold@web.de',       '+49 151 7790331', NULL,                                  '40032601', '14.6', 'cancelled');

-- ── mens-challenger (protected field: every entry LK ≥ 20) ───────────────────────────────────────
INSERT INTO registrations
  (created_at, updated_at, competition, first_name, last_name, club, email, phone, note, player_id, lk, status)
VALUES
  ('2026-06-06T17:02:00.000Z', '2026-06-07T09:18:00.000Z', 'mens-challenger', 'Holger',  'Timm',     'TV Winsen',  'holger.timm@gmx.de',         '+49 151 3345119', NULL,                              '40041203', '20.3', 'confirmed'),
  ('2026-06-07T19:48:00.000Z', '2026-06-08T08:30:00.000Z', 'mens-challenger', 'Bernd',   'Hahn',     'TSV Winsen', 'bernd.hahn@web.de',          '+49 170 5590124', NULL,                              '40041477', '20.9', 'confirmed'),
  ('2026-06-08T21:15:00.000Z', '2026-06-09T10:44:00.000Z', 'mens-challenger', 'Uwe',     'Kaiser',   'TV Winsen',  'uwe.kaiser@t-online.de',     '+49 160 2231870', 'Doppelpartner gesucht.',          '40041744', '21.4', 'confirmed'),
  ('2026-06-09T18:33:00.000Z', '2026-06-10T09:02:00.000Z', 'mens-challenger', 'Jörg',    'Peters',   'TSV Winsen', 'joerg.peters@gmail.com',     '+49 151 6678905', NULL,                              '40042011', '21.8', 'confirmed'),
  ('2026-06-10T20:51:00.000Z', '2026-06-11T08:19:00.000Z', 'mens-challenger', 'Frank',   'Ludwig',   'TV Winsen',  'frank.ludwig@gmx.de',        '+49 172 4498103', NULL,                              '40042288', '22.2', 'confirmed'),
  ('2026-06-12T16:24:00.000Z', '2026-06-13T11:37:00.000Z', 'mens-challenger', 'Ralf',    'Simon',    'TSV Winsen', 'ralf.simon@web.de',          '+49 151 9912045', NULL,                              '40042555', '22.7', 'confirmed'),
  ('2026-06-13T19:09:00.000Z', '2026-06-14T09:50:00.000Z', 'mens-challenger', 'Dirk',    'Weber',    'TV Winsen',  'dirk.weber@t-online.de',     '+49 160 7723109', NULL,                              '40042831', '23.1', 'confirmed'),
  ('2026-06-15T11:42:00.000Z', '2026-06-16T08:14:00.000Z', 'mens-challenger', 'Thomas',  'Jansen',   'TSV Winsen', 'thomas.jansen@gmail.com',    '+49 151 5567230', NULL,                              '40043108', '23.6', 'confirmed'),
  ('2026-06-16T18:55:00.000Z', '2026-06-17T10:28:00.000Z', 'mens-challenger', 'Michael', 'Horn',     'TV Winsen',  'michael.horn@gmx.de',        NULL,              'Komme direkt vom Spätdienst.',    '40043372', '24.0', 'confirmed'),
  ('2026-06-18T20:13:00.000Z', '2026-06-19T09:06:00.000Z', 'mens-challenger', 'Klaus',   'Brunner',  'TSV Winsen', 'klaus.brunner@web.de',       '+49 170 3340912', NULL,                              '40043649', '24.5', 'confirmed'),
  -- No-id confirms: both seed at DEFAULT_LK (25.0), still LK ≥ 20 so the field stays drawable.
  ('2026-06-20T17:38:00.000Z', '2026-06-21T08:52:00.000Z', 'mens-challenger', 'Werner',  'Scholz',   'TV Winsen',  'werner.scholz@t-online.de',  '+49 151 2290847', NULL,                              NULL,       '25.0', 'confirmed'),
  ('2026-06-21T19:20:00.000Z', '2026-06-22T10:15:00.000Z', 'mens-challenger', 'Günter',  'Maas',     'TSV Winsen', 'guenter.maas@gmx.de',        '+49 160 8812304', 'Keine nuLiga-ID.',                NULL,       '25.0', 'confirmed'),
  -- new
  ('2026-06-25T18:07:00.000Z', '2026-06-25T18:07:00.000Z', 'mens-challenger', 'Heiko',   'Pfeiffer', 'TSV Winsen', 'heiko.pfeiffer@gmail.com',   '+49 151 4423190', NULL,                              NULL,       NULL,   'new'),
  -- cancelled
  ('2026-06-11T09:31:00.000Z', '2026-06-19T16:44:00.000Z', 'mens-challenger', 'Manfred', 'Roth',     'TV Winsen',  'manfred.roth@web.de',        '+49 172 6610588', NULL,                              '40042422', '22.0', 'cancelled');
