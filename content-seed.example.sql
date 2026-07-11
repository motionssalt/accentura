-- ============================================================
-- content-seed.example.sql
-- ============================================================
-- PLACEHOLDER content only. Replace with your real facts/quotes
-- before running against your production D1 database.
--
-- Tier guide (matches "progressive" level auto-escalation):
--   tier 1 -> days  1- 7  (easy, short, common vocabulary)
--   tier 2 -> days  8-15  (medium, slightly longer sentences)
--   tier 3 -> days 16-23  (harder, richer vocabulary)
--   tier 4 -> days 24-30  (advanced, longer / literary)
--
-- Fixed levels map like this:
--   beginner     -> tier 1
--   intermediate -> tier 2
--   advanced     -> tier 3
--   progressive  -> escalates 1 -> 2 -> 3 -> 4 by day range
--
-- Type is either 'fact' or 'quote'. Keep each item under ~300
-- characters — Telegram voice notes should be short.
--
-- To load: open the D1 console for your database, paste this
-- file's contents, and run.
-- ============================================================

-- --- Tier 1 (PLACEHOLDER — replace) -----------------------------------------
INSERT INTO content_pool (tier, type, text) VALUES
  (1, 'fact',  'PLACEHOLDER: Honey never spoils. Archaeologists have found pots of honey in ancient Egyptian tombs that are over three thousand years old and still edible.'),
  (1, 'quote', 'PLACEHOLDER: "The only way to do great work is to love what you do." — Steve Jobs'),
  (1, 'fact',  'PLACEHOLDER: Octopuses have three hearts and blue blood. Two hearts pump blood to the gills, and the third pumps it to the rest of the body.');

-- --- Tier 2 (PLACEHOLDER — replace) -----------------------------------------
INSERT INTO content_pool (tier, type, text) VALUES
  (2, 'quote', 'PLACEHOLDER: "In the middle of every difficulty lies opportunity." — Albert Einstein'),
  (2, 'fact',  'PLACEHOLDER: Bananas are berries, but strawberries are not. Botanically, a berry must develop from a single flower with one ovary, which disqualifies the strawberry.');

-- --- Tier 3 (PLACEHOLDER — replace) -----------------------------------------
INSERT INTO content_pool (tier, type, text) VALUES
  (3, 'quote', 'PLACEHOLDER: "We are what we repeatedly do. Excellence, then, is not an act, but a habit." — Will Durant, paraphrasing Aristotle'),
  (3, 'fact',  'PLACEHOLDER: A single teaspoonful of neutron star material would weigh roughly six billion tons on Earth — comparable to the mass of Mount Everest.');

-- --- Tier 4 (PLACEHOLDER — replace) -----------------------------------------
INSERT INTO content_pool (tier, type, text) VALUES
  (4, 'quote', 'PLACEHOLDER: "The unexamined life is not worth living for a human being." — Socrates, as recounted by Plato in the Apology'),
  (4, 'fact',  'PLACEHOLDER: The mycelial networks of certain fungi can span hundreds of hectares underground, forming what many biologists consider a single contiguous organism and among the largest living things on Earth.');
