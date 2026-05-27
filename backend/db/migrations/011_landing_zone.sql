-- Code-health P3: landing-zone gate (Preparatory Refactoring). A bug/feature proposal that lands on a
-- toxic module gets a prerequisite = the ref_id of the refactor that should happen first. Auto-Dev holds
-- the proposal until that refactor is in progress/done (order enforcement, toggle config.landingZoneGate).
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS prerequisite text; -- ref_id (file path) of a refactor proposal that must land first
