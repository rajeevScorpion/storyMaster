-- 104_seed_agent_personas_rollback.sql
--
-- Removes the 15 seed personas.
--
-- DELETED BY EXPLICIT SLUG LIST, not by `WHERE is_seed = true`. By the time
-- anyone runs this, an admin may have cloned a seed persona or created their
-- own -- and a clone made through buildClonedPersonaInput() carries
-- is_seed = false, so a blanket delete would spare clones but a broader
-- predicate could easily take work that is not ours. Naming the 15 slugs makes
-- this rollback remove exactly what migration 104 inserted and nothing else.
--
-- agent_persona_memory rows disappear automatically: migration 103 declares
-- persona_id REFERENCES agent_personas(id) ON DELETE CASCADE.
--
-- stories.agent_persona_id is ON DELETE SET NULL, so any story a seed persona
-- produced survives this rollback and simply loses its persona attribution.
-- That is deliberate -- a rollback of the seed data must not destroy generated
-- content.

DELETE FROM public.agent_personas WHERE slug IN (
  'aarav-sharma',
  'riya-sen',
  'mihir-desai',
  'ananya-mehta',
  'vedant-kulkarni',
  'kavya-mishra',
  'ishani-chatterjee',
  'dhruv-patel',
  'tara-nair',
  'reva-joshi',
  'kabir-sinha',
  'madhurima-bose',
  'niyati-shah',
  'arjun-rao',
  'suhasini-patil'
);

DELETE FROM public.schema_migration_ledger WHERE migration_number = 104;
