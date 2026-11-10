-- Demo contact requests for local development: fills the dashboard's
-- Requests page with realistic rows. Inserts straight into the table, so
-- nothing is queued and no email is sent.
--
--   docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < scripts/demo-requests.sql
--
-- Re-running replaces the previous demo rows. Every demo row has an
-- idempotencyKey starting with 'demo-'; remove them all with:
--   DELETE FROM contact_requests WHERE "idempotencyKey" LIKE 'demo-%';
-- Uses every existing site (create sites first). Never run against production.

BEGIN;

DELETE FROM contact_requests WHERE "idempotencyKey" LIKE 'demo-%';

WITH
people(i, full_name, email, phone, company) AS (
  VALUES
    (0, 'Amina Wanjiru',    'amina.wanjiru@gmail.com',     '+254712345678', 'Wanjiru Traders'),
    (1, 'Brian Otieno',     'b.otieno@otienologistics.co.ke', '+254723456789', 'Otieno Logistics'),
    (2, 'Cynthia Mwangi',   'cynthia.m@outlook.com',       '+254734567890', NULL),
    (3, 'David Kiprotich',  'dkiprotich@kipfarm.co.ke',    '+254745678901', 'Kip Farm Supplies'),
    (4, 'Esther Njeri',     'esther.njeri@yahoo.com',      '+254756789012', NULL),
    (5, 'Felix Mutua',      'felix@mutuaventures.com',     '+254767890123', 'Mutua Ventures'),
    (6, 'Grace Achieng',    'grace.achieng@gmail.com',     '+254778901234', 'Achieng & Co.'),
    (7, 'Hassan Abdi',      'hassan.abdi@abdiexports.com', '+254789012345', 'Abdi Exports'),
    (8, 'Irene Chebet',     'irene.chebet@gmail.com',      '+254790123456', NULL),
    (9, 'James Kamau',      'jkamau@kamaubuilders.co.ke',  '+254701234567', 'Kamau Builders'),
    (10, 'Lucy Wairimu',    'lucy.wairimu@icloud.com',     '+254711223344', NULL),
    (11, 'Mohamed Yusuf',   'm.yusuf@coastfresh.co.ke',    '+254722334455', 'Coast Fresh'),
    (12, 'Naomi Atieno',    'naomi.atieno@gmail.com',      '+254733445566', 'Atieno Salon'),
    (13, 'Peter Ndungu',    'peter.ndungu@ndungutech.com', '+254744556677', 'Ndungu Tech'),
    (14, 'Ruth Moraa',      'ruth.moraa@outlook.com',      '+254755667788', NULL)
),
topics(i, subject, message) AS (
  VALUES
    (0, 'Pricing for monthly plan',
        E'Hello,\n\nCould you send me the pricing for the monthly plan? We are a team of 12 and would like to start next month.\n\nThanks.'),
    (1, 'Delivery to Mombasa',
        'Do you deliver to Mombasa, and how long does it usually take? I need an order there by Friday.'),
    (2, NULL,
        'Hi, I tried calling your office twice today but nobody picked up. Please call me back when you can.'),
    (3, 'Partnership enquiry',
        E'Good afternoon,\n\nWe run a chain of six shops in Nakuru and Eldoret and would like to discuss becoming a reseller. Who is the right person to talk to?\n\nRegards'),
    (4, 'Invoice INV-2041 not received',
        'We paid last week but have not received invoice INV-2041. Could you resend it to this address?'),
    (5, 'Request a demo',
        'I saw your stand at the expo. Can we book a 30-minute demo for Tuesday or Wednesday morning?'),
    (6, 'Bulk order quote',
        'Please quote for 500 units, delivered to our Industrial Area warehouse. We can pay on delivery or by M-Pesa.'),
    (7, NULL,
        'Is the offer on your homepage still valid?'),
    (8, 'Account locked',
        E'I can''t log in to my account since this morning. It says my account is locked.\n\nMy username is the same as this email.'),
    (9, 'Job application follow-up',
        'I applied for the sales associate role two weeks ago and wanted to check on the status of my application.'),
    (10, 'Feedback on last order',
        'Just wanted to say the last delivery was fast and the driver was very polite. Thank you!'),
    (11, 'Refund request',
        E'Order #8812 arrived damaged (photos available). I would like a refund or a replacement.\n\nPlease advise on next steps.')
),
failures(i, error) AS (
  VALUES
    (0, 'connect ETIMEDOUT 203.0.113.25:587'),
    (1, '421 4.7.0 Try again later, closing connection'),
    (2, 'Invalid login: 535 5.7.8 Username and Password not accepted'),
    (3, '550 5.1.1 The email account that you tried to reach does not exist')
),
sites AS (
  SELECT id, recipient, "ccRecipients", row_number() OVER (ORDER BY id) - 1 AS idx, count(*) OVER () AS n
  FROM sites WHERE "isActive"
),
rows AS (
  SELECT
    g,
    -- Spread over the last 30 days, newest first, at varied times of day.
    date_trunc('minute', now() - (g * interval '11 hours') - ((g * 37) % 300) * interval '1 minute') AS created,
    -- Mostly sent; some queued/pending/failed. The newest rows are the
    -- ones still in flight, as they would be in real life.
    CASE
      WHEN g IN (0, 1) THEN 'queued'
      WHEN g = 2 THEN 'pending'
      WHEN g IN (3, 9) THEN 'failed-retrying'
      WHEN g IN (14, 27, 41) THEN 'failed'
      ELSE 'sent'
    END AS kind
  FROM generate_series(0, 59) AS g
)
INSERT INTO contact_requests (
  "idempotencyKey", "siteId", "fullName", email, "phoneNumber", company, subject, message,
  status, "createdAt", "deliveredTo", "ccTo", "sentAt", attempts, "lastAttemptAt", "lastError"
)
SELECT
  'demo-' || r.g,
  s.id,
  p.full_name,
  p.email,
  p.phone,
  p.company,
  t.subject,
  t.message,
  CASE r.kind WHEN 'failed-retrying' THEN 'failed' ELSE r.kind END,
  r.created,
  CASE WHEN r.kind = 'sent' THEN s.recipient END,
  CASE WHEN r.kind = 'sent' THEN s."ccRecipients" ELSE '{}' END,
  CASE WHEN r.kind = 'sent' THEN r.created + ((r.g % 7) + 2) * interval '1 second' END,
  CASE r.kind
    WHEN 'sent' THEN CASE WHEN r.g % 9 = 0 THEN 2 ELSE 1 END
    WHEN 'failed-retrying' THEN 2
    WHEN 'failed' THEN 5
    ELSE 0
  END,
  CASE WHEN r.kind IN ('failed', 'failed-retrying') THEN r.created + interval '3 minutes' END,
  CASE WHEN r.kind IN ('failed', 'failed-retrying') THEN f.error END
FROM rows r
JOIN sites s ON s.idx = r.g % s.n
JOIN people p ON p.i = (r.g * 7) % 15
JOIN topics t ON t.i = (r.g * 5) % 12
JOIN failures f ON f.i = r.g % 4;

SELECT "siteId", status, count(*) FROM contact_requests
WHERE "idempotencyKey" LIKE 'demo-%' GROUP BY 1, 2 ORDER BY 1, 2;

COMMIT;
