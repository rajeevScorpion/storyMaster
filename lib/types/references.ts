// Reference Personalization types — shared by client and server.
//
// Kept free of imports from lib/types/story.ts so story.ts can import the
// StoryConfig-embedded types below without a cycle.

export type ReferenceKind = 'character' | 'world';

export type ReferenceSourceStatus = 'uploaded' | 'removed';

export type ReferenceAdoptionStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'cancelled';

/**
 * How a reference is turned into continuity input.
 *  - canonical_visual: character path — always produces a canonical styled image.
 *  - description_only: world path — structured World DNA text, no generated image.
 *  - description_plus_canonical_visual: world path — DNA text + one styled visualization.
 */
export type ReferenceAdoptionMode =
  | 'canonical_visual'
  | 'description_only'
  | 'description_plus_canonical_visual';

/** World visualization policy resolved from tier settings. */
export type WorldAdoptionMode = 'description_only' | 'description_plus_canonical_visual';

// ---------------------------------------------------------------------------
// DB row shapes (snake_case, as returned by Supabase)
// ---------------------------------------------------------------------------

export interface DbReferenceSource {
  id: string;
  user_id: string;
  setup_id: string;
  story_id: string | null;
  kind: ReferenceKind;
  slot_index: number;
  display_name: string | null;
  r2_bucket: string;
  r2_object_key: string;
  checksum_sha256: string | null;
  mime_type: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  status: ReferenceSourceStatus;
  created_at: string;
  updated_at: string;
}

export interface DbReferenceAdoption {
  id: string;
  user_id: string;
  setup_id: string;
  story_id: string | null;
  source_id: string;
  kind: ReferenceKind;
  adoption_mode: ReferenceAdoptionMode;
  status: ReferenceAdoptionStatus;
  display_name: string | null;
  structured_json: CharacterReferenceDescription | WorldReferenceDescription | Record<string, never>;
  prompt_anchor: string | null;
  canonical_r2_bucket: string | null;
  canonical_r2_object_key: string | null;
  image_model_snapshot: Record<string, unknown> | null;
  visual_style: string | null;
  reservation_id: string | null;
  visualization_reservation_id: string | null;
  attempt_count: number;
  max_attempts: number;
  error: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Structured descriptions (versioned; mirror the pack schema examples)
// ---------------------------------------------------------------------------

export const CHARACTER_DESCRIPTION_SCHEMA_VERSION = 1;
export const WORLD_DESCRIPTION_SCHEMA_VERSION = 1;

export interface CharacterReferenceDescription {
  schemaVersion: number;
  summary: string;
  subjectType: string; // 'human' | 'animal' | 'creature' | 'object' | ...
  stableTraits: {
    face: string[];
    hair: string[];
    silhouette: string[];
    marks: string[];
    stableAccessories: string[];
  };
  changeable: {
    clothing: string[];
    pose: string[];
    expression: string[];
  };
  continuityAnchors: string[];
  prohibitedDrift: string[];
  /**
   * Set by the analyzer when the image cannot be used as a single clear
   * character (collage, no clear subject, unsafe, etc). Presence = quality gate
   * failure; the adoption is failed permanently with a user-safe message.
   */
  unusableReason?: string;
}

export interface WorldReferenceDescription {
  schemaVersion: number;
  summary: string;
  worldType: string;
  architecture: string[];
  geography: string[];
  spatialLayout: string[];
  materials: string[];
  lighting: string[];
  atmosphere: string[];
  recurringObjects: string[];
  continuityAnchors: string[];
  keywords: string[];      // used by beat-level world relevance matching
  incidentalElements: string[]; // to ignore, not preserve
  prohibitedDrift: string[];
  unusableReason?: string;
}

// ---------------------------------------------------------------------------
// StoryConfig-embedded reference context (persisted in story_config JSONB)
// ---------------------------------------------------------------------------

/**
 * A resolved world adoption carried on the story config so beat generation and
 * image routing can reach world anchors + canonical visualizations without a DB
 * round-trip. Characters do NOT live here — they are seeded as ordinary roster
 * characters via StorySeedOptions.seedCharacters.
 */
export interface StoryConfigWorldReference {
  adoptionId: string;
  worldId: string;       // stable id used for beat relevance resolution
  label: string;
  anchor: string;        // compiled compact prompt anchor
  keywords: string[];    // relevance-match terms
  adoptionMode: WorldAdoptionMode;
  canonicalStorageKey?: string; // r2://bucket/key of the styled world visualization
}

export interface StoryConfigReferences {
  setupId: string;
  worlds: StoryConfigWorldReference[];
}

// ---------------------------------------------------------------------------
// Setup status projections for the story-creation UI (owner-read polling)
// ---------------------------------------------------------------------------

export interface ReferenceSetupItemStatus {
  sourceId: string;
  adoptionId: string | null;
  kind: ReferenceKind;
  slotIndex: number;
  displayName: string | null;
  status: ReferenceAdoptionStatus | 'uploaded';
  previewUrl: string | null;   // signed preview of the original upload
  canonicalUrl: string | null; // signed url of the adopted asset when ready
  error: string | null;
}

export interface ReferenceSetupStatus {
  setupId: string;
  items: ReferenceSetupItemStatus[];
  allResolved: boolean; // every non-removed item is ready or failed (no pending/processing)
  hasPending: boolean;
}
