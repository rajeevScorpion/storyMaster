import Link from 'next/link';
import { Activity, BarChart3, Coins, ExternalLink, GitBranch, UserRound } from 'lucide-react';
import { getCostDashboardData, type AdminCostBeatRow } from '@/app/actions/cost-admin';

export const dynamic = 'force-dynamic';

interface AdminCostPageProps {
  searchParams: Promise<{
    userId?: string | string[];
  }>;
}

function parseStringParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || null;
}

function formatUsd(value: number) {
  if (value === 0) return '$0.000000';
  if (value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(4)}`;
}

function formatInr(value: number) {
  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: value < 10 ? 2 : 0,
    maximumFractionDigits: value < 10 ? 2 : 0,
  })}`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function activityLabel(key: string) {
  const labels: Record<string, string> = {
    start_story_initial_beat: 'Story start',
    start_story_initial_beat_prompt_only: 'Story start (BYOI)',
    start_reel_full_generation: 'Reel (full)',
    start_reel_full_generation_prompt_only: 'Reel (BYOI)',
    continue_story_new_beat: 'New beat',
    continue_story_new_beat_prompt_only: 'New beat (BYOI)',
    preview_seed_plan: 'Seed preview',
    regenerate_image: 'Image regen',
    regenerate_narration: 'Narration regen',
    generate_social_share_cover: 'Share cover',
    generate_audio_story_cover: 'Audio cover',
    generate_reel_thumbnail: 'Reel thumb',
    generate_story_text_overlay: 'Text overlay',
    batch_image_generation: 'Batch image',
  };
  return labels[key] || key.replaceAll('_', ' ');
}

function generationModeLabel(mode: string) {
  const labels: Record<string, string> = {
    regular: 'Regular',
    batch: 'Batch',
    stateful: 'Stateful',
  };
  return labels[mode] || mode;
}

function taskLabel(key: string) {
  const labels: Record<string, string> = {
    story_generation: 'Story',
    seed_plan_generation: 'Seed plan',
    seeded_beat_materialization: 'Seeded beat',
    visual_prompt: 'Visual plan',
    reel_visual_prompt: 'Reel visual plan',
    image_generation: 'Image',
    reel_image_generation: 'Reel image',
    portrait_generation: 'Portraits',
    reel_story_generation: 'Reel story',
    tts: 'TTS',
    reel_tts: 'Reel TTS',
    story_text_overlay_alignment: 'Overlay STT',
    voice_selection: 'Voice',
  };
  return labels[key] || key.replaceAll('_', ' ');
}

function shortId(id: string | null | undefined) {
  if (!id) return 'none';
  return id.length > 12 ? `${id.slice(0, 8)}...` : id;
}

function CostBreakdown({ beat }: { beat: AdminCostBeatRow }) {
  if (beat.breakdown.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
        No cost events are linked to this beat yet. New generations will appear after the telemetry migration is applied.
      </p>
    );
  }

  return (
    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      {beat.breakdown.map((item) => (
        <div key={item.taskKey} className="rounded-lg border border-white/10 bg-neutral-950/60 p-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-500">{taskLabel(item.taskKey)}</p>
            <p className="text-sm text-emerald-300">{formatInr(item.estimatedCostUsd * 93)}</p>
          </div>
          {item.generationModes.some((mode) => mode !== 'regular') && (
            <div className="mt-1 flex flex-wrap gap-1">
              {item.generationModes.map((mode) => (
                <span
                  key={mode}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                    mode === 'batch'
                      ? 'bg-indigo-500/15 text-indigo-300'
                      : mode === 'stateful'
                      ? 'bg-purple-500/15 text-purple-300'
                      : 'bg-white/5 text-neutral-400'
                  }`}
                >
                  {generationModeLabel(mode)}
                </span>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs text-neutral-500">{formatUsd(item.estimatedCostUsd)}</p>
          <p className="mt-2 truncate text-xs text-neutral-400" title={(item.providers.length ? item.providers : item.models).join(', ')}>
            {(item.providers.length ? item.providers : item.models).join(', ')}
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            {item.inputTokens.toLocaleString()} in / {item.outputTokens.toLocaleString()} out
            {item.cachedTokens > 0 ? ` / ${item.cachedTokens.toLocaleString()} cached` : ''}
            {item.imageCount > 0 ? ` / ${item.imageCount} image${item.imageCount === 1 ? '' : 's'}` : ''}
            {item.audioSeconds > 0 ? ` / ${item.audioSeconds.toFixed(1)}s audio` : ''}
          </p>
          {(item.runtimeCostUsd > 0 || item.imageCostUsd > 0 || item.strategies.length > 0 || item.fallbacks.length > 0) && (
            <p className="mt-2 text-xs text-neutral-500">
              {item.runtimeCostUsd > 0 ? `runtime ${formatUsd(item.runtimeCostUsd)}` : ''}
              {item.runtimeCostUsd > 0 && item.imageCostUsd > 0 ? ' / ' : ''}
              {item.imageCostUsd > 0 ? `image ${formatUsd(item.imageCostUsd)}` : ''}
              {item.strategies.length > 0 ? ` / ${item.strategies.join(', ')}` : ''}
              {item.fallbacks.length > 0 ? ` / fallback: ${item.fallbacks.join(', ')}` : ''}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export default async function AdminCostPage({ searchParams }: AdminCostPageProps) {
  const params = await searchParams;
  const data = await getCostDashboardData({
    userId: parseStringParam(params.userId),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-300/80">Cost observability</p>
          <h1 className="mt-2 text-3xl font-serif text-neutral-100">AI Cost Dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-400">
            Tracks model-call estimates by beat, story, user, and daily activity. INR uses ₹{data.inrPerUsd}/USD.
          </p>
          {data.userFilterId && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200">
                User filter: {shortId(data.userFilterId)}
              </span>
              <Link href="/admin/cost" className="text-xs text-neutral-400 hover:text-neutral-200">
                Clear filter
              </Link>
            </div>
          )}
        </div>
        <div className="grid min-w-72 grid-cols-2 gap-3">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-neutral-500">
              <Coins className="h-4 w-4" />
              {data.dailyWindowDays} days
            </div>
            <p className="mt-2 text-2xl font-semibold text-neutral-100">{formatInr(data.totalWindowCostInr)}</p>
            <p className="mt-1 text-xs text-neutral-500">{formatUsd(data.totalWindowCostUsd)}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-neutral-500">
              <BarChart3 className="h-4 w-4" />
              Events
            </div>
            <p className="mt-2 text-2xl font-semibold text-neutral-100">
              {data.dailyActivity.reduce((sum, row) => sum + row.eventCount, 0).toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-neutral-500">logged model calls</p>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-emerald-300" />
          <h2 className="text-xl font-serif text-neutral-100">Last 5 Generated Beats</h2>
        </div>

        <div className="space-y-3">
          {data.recentBeats.map((beat) => (
            <article key={beat.beatId} className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-emerald-500/15 px-2 py-1 text-xs text-emerald-200">
                      Beat {beat.beatNumber}
                    </span>
                    <span className="text-xs text-neutral-500">{formatDateTime(beat.generatedAt)}</span>
                    <code className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-neutral-500">
                      {shortId(beat.beatId)}
                    </code>
                  </div>
                  <h3 className="mt-2 truncate text-lg font-medium text-neutral-100">{beat.title}</h3>
                  <div className="mt-2 flex flex-wrap gap-3 text-sm text-neutral-400">
                    {beat.userId ? (
                      <Link
                        href={`/admin/cost?userId=${beat.userId}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-neutral-950/50 px-2 py-1 text-xs text-neutral-300 hover:bg-white/10"
                      >
                        <UserRound className="h-4 w-4" />
                        {beat.userLabel}
                      </Link>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <UserRound className="h-4 w-4" />
                        {beat.userLabel}
                      </span>
                    )}
                    {beat.userId && <code className="text-xs text-neutral-600">{shortId(beat.userId)}</code>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href={beat.storyHref}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-neutral-950/50 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/10"
                    >
                      Story: {beat.storyTitle}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                    {beat.storylineHref ? (
                      <Link
                        href={beat.storylineHref}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-neutral-950/50 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/10"
                      >
                        Storyline: {beat.storylineTitle || shortId(beat.storylineId)}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    ) : (
                      <span className="rounded-lg border border-white/10 bg-neutral-950/50 px-3 py-1.5 text-xs text-neutral-500">
                        No published storyline yet
                      </span>
                    )}
                  </div>
                </div>

                <div className="min-w-40 text-right">
                  <p className="text-2xl font-semibold text-emerald-300">{formatInr(beat.totalCostInr)}</p>
                  <p className="mt-1 text-xs text-neutral-500">{formatUsd(beat.totalCostUsd)}</p>
                  <p className="mt-2 text-xs text-neutral-500">{beat.eventCount} model calls</p>
                </div>
              </div>
              <CostBreakdown beat={beat} />
            </article>
          ))}

          {data.recentBeats.length === 0 && (
            <div className="rounded-lg border border-white/10 bg-white/5 p-8 text-center text-sm text-neutral-500">
              No generated beats found yet.
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-emerald-300" />
          <h2 className="text-xl font-serif text-neutral-100">Daily Cost by Activity</h2>
        </div>

        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5 text-left text-neutral-500">
                <th className="px-4 py-3 font-medium">Day</th>
                <th className="px-4 py-3 font-medium">Activity</th>
                <th className="px-4 py-3 text-right font-medium">Cost INR</th>
                <th className="px-4 py-3 text-right font-medium">Cost USD</th>
                <th className="px-4 py-3 text-right font-medium">Beats</th>
                <th className="px-4 py-3 text-right font-medium">Events</th>
              </tr>
            </thead>
            <tbody>
              {data.dailyActivity.map((row) => (
                <tr key={`${row.day}:${row.activityKey}`} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3 text-neutral-300">{row.day}</td>
                  <td className="px-4 py-3 text-neutral-300">{activityLabel(row.activityKey)}</td>
                  <td className="px-4 py-3 text-right text-emerald-300">{formatInr(row.estimatedCostInr)}</td>
                  <td className="px-4 py-3 text-right text-neutral-500">{formatUsd(row.estimatedCostUsd)}</td>
                  <td className="px-4 py-3 text-right text-neutral-400">{row.beatCount || '-'}</td>
                  <td className="px-4 py-3 text-right text-neutral-400">{row.eventCount}</td>
                </tr>
              ))}
              {data.dailyActivity.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">
                    No cost events in the last {data.dailyWindowDays} days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
