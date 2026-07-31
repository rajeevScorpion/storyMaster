import type { ComponentType } from 'react';
import {
  BookOpen,
  BookOpenText,
  BookUser,
  Braces,
  Brush,
  Clapperboard,
  Clock3,
  Coins,
  CreditCard,
  Database,
  FileText,
  Film,
  FlaskConical,
  ImageIcon,
  ImageUp,
  Images,
  Layers,
  LayoutGrid,
  LifeBuoy,
  Megaphone,
  Mic2,
  Package,
  Palette,
  PenLine,
  Settings,
  Settings2,
  ShieldAlert,
  ScrollText,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  UsersRound,
  Video,
  WalletCards,
  Wind,
  Workflow,
  Wrench,
} from 'lucide-react';

// ── Single source of truth for the admin navigation tree ───────────────
// Consumed by AdminSidebar / AdminNavList (sidebar + mobile drawer), the
// GlobalSettings overview hub, and the PricingStudio workshop hub. Keeping
// one config here prevents the sidebar and hub grids from drifting apart
// (labels, hrefs, icons, and the set of destinations stay in lockstep).

export type AdminNavIcon = ComponentType<{ size?: number; className?: string }>;

/** A leaf destination: one sidebar child row and one hub card. */
export interface AdminNavChild {
  /** Stable id; for settings/pricing children this equals the route slug. */
  id: string;
  /** Canonical label used in BOTH the sidebar and the hub card. */
  label: string;
  /** Must match the existing route exactly — never change a href here. */
  href: string;
  icon: AdminNavIcon;
  /** Hub-card body copy. */
  description: string;
  /** Hub-card summary line used when no live summary is available. */
  staticSummary?: string;
}

/** Presentation-only grouping of children. `label: null` renders ungrouped. */
export interface AdminNavChildGroup {
  id: string;
  label: string | null;
  items: AdminNavChild[];
}

export interface AdminNavItem {
  label: string;
  href: string;
  icon: AdminNavIcon;
  childGroups?: AdminNavChildGroup[];
}

export interface AdminNavGroup {
  id: string;
  label: string;
  items: AdminNavItem[];
}

// Operator-oriented grouping of the Global Settings destinations. Groups
// follow the operator's mental model of the content pipeline: how a story
// reads (Story & Reels), how images are produced/processed (Media & Images),
// who appears in stories (Characters & Personalization), sound/video output
// (Audio & Video), and infra/rollout (Platform). Reel Story lives in
// Story & Reels because its settings are generation defaults, not delivery
// infra. Every id equals its route slug; icons are unique within this list.
const SETTINGS_CHILD_GROUPS: AdminNavChildGroup[] = [
  {
    id: 'general',
    label: null,
    items: [
      {
        id: 'overview',
        label: 'Overview',
        href: '/admin/settings',
        icon: LayoutGrid,
        description: 'Review the global runtime controls and jump into focused settings pages.',
      },
    ],
  },
  {
    id: 'story-reels',
    label: 'Story & Reels',
    items: [
      {
        id: 'storyboard',
        label: 'Storyboard',
        href: '/admin/settings/storyboard',
        icon: Brush,
        description: 'Image output, panel timing, WebP processing, layout, and vignette controls.',
      },
      {
        id: 'reels',
        label: 'Reel Story',
        href: '/admin/settings/reels',
        icon: Clapperboard,
        description: 'Short-form reel defaults, prompt definers, retention windows, and manual cleanup.',
        staticSummary: 'Prompt-only 9:16 reels, editable JSON definers, and manual draft cleanup',
      },
      {
        id: 'reader',
        label: 'Reader and loader',
        href: '/admin/settings/reader',
        icon: BookOpenText,
        description: 'Story text display, auto-scroll, loading labels, and generated text reveal behavior.',
      },
      {
        id: 'authoring',
        label: 'Authoring',
        href: '/admin/settings/authoring',
        icon: PenLine,
        description: 'Prompt/seed authoring limits and seed preview pricing.',
      },
      {
        id: 'beat-control',
        label: 'Beat control',
        href: '/admin/settings/beat-control',
        icon: SlidersHorizontal,
        description: 'Beat text editing, timeline rewrite, image/narration/options regeneration, custom options, and version history.',
        staticSummary: 'Beat editing, timeline rewrite, regeneration controls, custom options, and version history',
      },
    ],
  },
  {
    id: 'media-images',
    label: 'Media & Images',
    items: [
      {
        id: 'media',
        label: 'Image uploads',
        href: '/admin/settings/media',
        icon: ImageUp,
        description: 'Client-side upload compression, raw limits, optimized size limits, and rollback controls.',
      },
      {
        id: 'media-pipeline',
        label: 'Media pipeline',
        href: '/admin/settings/media-pipeline',
        icon: Workflow,
        description: 'Server-side processing mode, HQ retention, variants, cleanup, publishing gates, and job monitoring.',
        staticSummary: 'Server-side processing mode, HQ retention, variants, cleanup, and job monitoring',
      },
      {
        id: 'image-batch',
        label: 'Batch visuals',
        href: '/admin/settings/image-batch',
        icon: Layers,
        description: 'Batch image generation scope and rollout controls for bulk visual jobs.',
        staticSummary: 'Batch visuals scope and rollout controls',
      },
      {
        id: 'prompt-compiler',
        label: 'Image prompt compiler',
        href: '/admin/settings/prompt-compiler',
        icon: Braces,
        description: 'JSON image prompt optimization: rollout mode, per-model capability status, and legacy-vs-compiled comparisons.',
        staticSummary: 'Compiler rollout mode and per-model capability status',
      },
    ],
  },
  {
    id: 'characters-personalization',
    label: 'Characters & Personalization',
    items: [
      {
        id: 'characters',
        label: 'Character references',
        href: '/admin/settings/characters',
        icon: UserRound,
        description: 'Character sheet availability for Free, Plus, and Creator workflows.',
      },
      {
        id: 'character-universe',
        label: 'Characters & episodes',
        href: '/admin/settings/character-universe',
        icon: UsersRound,
        description: 'Character library, save-to-library, character mixing, episodic branching, story bible, and journal.',
        staticSummary: 'Character library, mixing, episodic branching, story bible, and journal',
      },
      {
        id: 'references',
        label: 'References & personalization',
        href: '/admin/settings/references',
        icon: BookUser,
        description: 'Reference image sources, personalization defaults, and reference slot availability.',
        staticSummary: 'Reference library and personalization controls',
      },
    ],
  },
  {
    id: 'audio-video',
    label: 'Audio & Video',
    items: [
      {
        id: 'narration',
        label: 'Narration voices',
        href: '/admin/settings/narration',
        icon: Mic2,
        description: 'User-led voice selection, curated voice lists, sample text, and sample generation status.',
      },
      {
        id: 'video-export',
        label: 'Video export',
        href: '/admin/settings/video-export',
        icon: Video,
        description: 'Global video download availability and admin-only bypass for testing.',
      },
    ],
  },
  {
    id: 'platform',
    label: 'Platform',
    items: [
      {
        id: 'generation',
        label: 'Generation timeouts',
        href: '/admin/settings/generation',
        icon: Clock3,
        description: 'Gemini text, image, TTS, and cloud-save timeout guards.',
      },
      {
        id: 'pages',
        label: 'Pages',
        href: '/admin/settings/pages',
        icon: FileText,
        description: 'Rollout legal, support, blog, docs, FAQ, and footer controls.',
        staticSummary: 'Managed rollout pages, footer controls, and route guards',
      },
    ],
  },
];

// Pricing workspace destinations. ids match PricingStudioSection values plus
// the standalone `audit` page; labels/hrefs are unchanged from the prior
// PRICING_WORKSPACE_LINKS. Icons are unique within this list.
const PRICING_CHILD_GROUP: AdminNavChildGroup = {
  id: 'pricing',
  label: null,
  items: [
    {
      id: 'workshop',
      label: 'Pricing workshop',
      href: '/admin/pricing',
      icon: Coins,
      description: 'Review pricing catalog health and jump into focused tools.',
      staticSummary: 'Catalog health overview and focused tools',
    },
    {
      id: 'plans',
      label: 'Plans',
      href: '/admin/pricing/plans',
      icon: CreditCard,
      description: 'Draft and publish plan variants by market and interval.',
      staticSummary: 'Draft, publish, and archive plan variants',
    },
    {
      id: 'top-up-packs',
      label: 'Top-up packs',
      href: '/admin/pricing/top-up-packs',
      icon: Package,
      description: 'Manage one-time coin packs by market.',
      staticSummary: 'One-time coin packs by market',
    },
    {
      id: 'promotions',
      label: 'Promotions',
      href: '/admin/pricing/promotions',
      icon: Megaphone,
      description: 'Create and archive campaign bonus offers.',
      staticSummary: 'Campaign bonus offers',
    },
    {
      id: 'action-costs',
      label: 'Action costs',
      href: '/admin/pricing/action-costs',
      icon: Sparkles,
      description: 'Set immediate-save coin costs for billable actions.',
      staticSummary: 'Coin costs for billable actions',
    },
    {
      id: 'runtime-controls',
      label: 'Runtime controls',
      href: '/admin/pricing/runtime-controls',
      icon: Settings2,
      description: 'Control visibility, rollout behavior, and live settings.',
      staticSummary: 'Visibility, rollout, and live settings',
    },
    {
      id: 'recovery-tools',
      label: 'Recovery tools',
      href: '/admin/pricing/recovery-tools',
      icon: Wrench,
      description: 'Repair test wallet, checkout, and reservation issues.',
      staticSummary: 'Repair wallet, checkout, and reservations',
    },
    {
      id: 'audit',
      label: 'Recent audit',
      href: '/admin/pricing/audit',
      icon: ShieldAlert,
      description: 'Review pricing changes with paginated history.',
      staticSummary: 'Paginated pricing change history',
    },
  ],
};

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    id: 'operations',
    label: 'Operations',
    items: [
      {
        label: 'User management',
        href: '/admin/users',
        icon: UsersRound,
        childGroups: [
          {
            id: 'users',
            label: null,
            items: [
              {
                id: 'cohorts',
                label: 'Promotional cohorts',
                href: '/admin/users/cohorts',
                icon: Megaphone,
                description: 'Reward a previewed, rule-based audience with audited promotional coins.',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    items: [
      { label: 'Content', href: '/admin/content', icon: BookOpen },
      { label: 'Share Covers', href: '/admin/share-covers', icon: ImageIcon },
      { label: 'Backfill', href: '/admin/backfill', icon: Database },
    ],
  },
  {
    id: 'studio',
    label: 'Studio',
    items: [
      { label: 'Image Models', href: '/admin/image-models', icon: Images },
      { label: 'Graphic Styles', href: '/admin/graphic-styles', icon: Palette },
      { label: 'Moods', href: '/admin/moods', icon: Wind },
      { label: 'Story Playground', href: '/admin/story-playground', icon: FlaskConical },
      { label: 'Reel Playground', href: '/admin/reel-playground', icon: Film },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      { label: 'Cost', href: '/admin/cost', icon: WalletCards },
      { label: 'Pricing and offers', href: '/admin/pricing', icon: Coins, childGroups: [PRICING_CHILD_GROUP] },
    ],
  },
  {
    id: 'configuration',
    label: 'Configuration',
    items: [
      { label: 'Global Settings', href: '/admin/settings', icon: Settings, childGroups: SETTINGS_CHILD_GROUPS },
      { label: 'Operational policies', href: '/admin/policies', icon: ScrollText },
      { label: 'Admin manual', href: '/admin/help', icon: LifeBuoy },
    ],
  },
];

// ── Convenience views ──────────────────────────────────────────────────

export const SETTINGS_NAV_GROUPS: AdminNavChildGroup[] = SETTINGS_CHILD_GROUPS;

export const SETTINGS_NAV_ITEMS: AdminNavChild[] = SETTINGS_CHILD_GROUPS.flatMap((group) => group.items);

export const PRICING_NAV_ITEMS: AdminNavChild[] = PRICING_CHILD_GROUP.items;

export function findSettingsNavItem(id: string): AdminNavChild | undefined {
  return SETTINGS_NAV_ITEMS.find((item) => item.id === id);
}

export function findPricingNavItem(id: string): AdminNavChild | undefined {
  return PRICING_NAV_ITEMS.find((item) => item.id === id);
}
