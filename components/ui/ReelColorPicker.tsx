'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Blend,
  Focus,
  Radius,
  StretchHorizontal,
  UnfoldHorizontal,
  UnfoldVertical,
  type LucideIcon,
} from 'lucide-react';
import {
  DEFAULT_REEL_TEXT_OVERLAY_STYLE,
  REEL_CAPTION_BACKGROUND_BLUR_MAX,
  REEL_CAPTION_BACKGROUND_BLUR_MIN,
  REEL_WORD_HIGHLIGHT_PADDING_X_MAX,
  REEL_WORD_HIGHLIGHT_PADDING_X_MIN,
  REEL_WORD_HIGHLIGHT_PADDING_Y_MAX,
  REEL_WORD_HIGHLIGHT_PADDING_Y_MIN,
  REEL_WORD_HIGHLIGHT_RADIUS_MAX,
  REEL_WORD_HIGHLIGHT_RADIUS_MIN,
  REEL_WORD_HIGHLIGHT_WORD_SPACING_MAX,
  REEL_WORD_HIGHLIGHT_WORD_SPACING_MIN,
  reelColorInputValue,
  reelColorToRgb,
  reelColorWithOpacity,
  reelRgbToHex,
} from '@/lib/reel/styles';

function clampReelNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeOpacityInput(value: number): number {
  return Math.round(clampReelNumber(value, 0, 1) * 100) / 100;
}

function reelOverlayColorInputValue(
  color: string | undefined,
  fallback: string
): string {
  return reelColorInputValue(color, fallback);
}

interface ReelStyleNumberInputProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  onCommit: (value: number) => void;
}

export function ReelStyleNumberInput({
  value,
  min,
  max,
  step = 1,
  label,
  onCommit,
}: ReelStyleNumberInputProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = useCallback(() => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const rounded = step < 1
      ? Math.round(parsed / step) * step
      : Math.round(parsed);
    const next = clampReelNumber(rounded, min, max);
    onCommit(step < 1 ? normalizeOpacityInput(next) : next);
    setDraft(String(step < 1 ? normalizeOpacityInput(next) : next));
  }, [draft, max, min, onCommit, step, value]);

  return (
    <input
      type="text"
      inputMode={step < 1 ? 'decimal' : 'numeric'}
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
      className="h-7 w-12 rounded-lg border border-white/10 bg-black/20 px-2 text-right font-sans text-[11px] tabular-nums text-neutral-200 outline-none transition-colors focus:border-emerald-400/50"
    />
  );
}

interface ReelIconSliderControlProps {
  icon: LucideIcon;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}

function ReelIconSliderControl({
  icon: Icon,
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: ReelIconSliderControlProps) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-500" aria-hidden="true" />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-w-0 flex-1 accent-emerald-400"
      />
      <ReelStyleNumberInput
        value={value}
        min={min}
        max={max}
        step={step}
        label={label}
        onCommit={onChange}
      />
    </div>
  );
}

const REEL_COLOR_SWATCHES = [
  '#000000',
  '#ffffff',
  '#C65A2E',
  '#00D49B',
  '#2563EB',
  '#A855F7',
  '#F59E0B',
  '#EF4444',
] as const;

interface ReelRgbChannelControlProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
}

function ReelRgbChannelControl({ label, value, onChange }: ReelRgbChannelControlProps) {
  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)_3rem] items-center gap-2">
      <span className="font-sans text-[10px] uppercase text-neutral-500">{label}</span>
      <input
        type="range"
        min={0}
        max={255}
        value={value}
        aria-label={`${label} channel`}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-w-0 accent-emerald-400"
      />
      <ReelStyleNumberInput
        value={value}
        min={0}
        max={255}
        label={`${label} channel value`}
        onCommit={onChange}
      />
    </div>
  );
}

export interface ReelStyleColorControlProps {
  label: string;
  color: string | undefined;
  fallback: string;
  opacity?: number;
  blur?: number;
  sampleText?: string;
  samplePaddingX?: number;
  samplePaddingY?: number;
  sampleBorderRadius?: number;
  sampleWordSpacing?: number;
  onSamplePaddingXChange?: (padding: number) => void;
  onSamplePaddingYChange?: (padding: number) => void;
  onSampleBorderRadiusChange?: (radius: number) => void;
  onSampleWordSpacingChange?: (spacing: number) => void;
  onColorChange: (color: string) => void;
  onOpacityChange?: (opacity: number) => void;
  onBlurChange?: (blur: number) => void;
}

/**
 * Themed color control used by the Reels overlay editor and the storyboard dialogs.
 * Caption-only props (opacity / sample padding / blur) are optional — when
 * `onOpacityChange` is omitted the control renders as a plain swatch + hex + popover
 * picker, suitable for simple color fields (particle color, text color, etc.).
 */
export function ReelStyleColorControl({
  label,
  color,
  fallback,
  opacity,
  blur,
  sampleText,
  samplePaddingX,
  samplePaddingY,
  sampleBorderRadius,
  sampleWordSpacing,
  onSamplePaddingXChange,
  onSamplePaddingYChange,
  onSampleBorderRadiusChange,
  onSampleWordSpacingChange,
  onColorChange,
  onOpacityChange,
  onBlurChange,
}: ReelStyleColorControlProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const colorInputValue = reelOverlayColorInputValue(color, fallback);
  const rgb: [number, number, number] = reelColorToRgb(colorInputValue) ?? [0, 0, 0];
  const opacityPercent = Math.round((opacity ?? 0) * 100);
  const showSample = Boolean(sampleText);
  const normalizedSamplePaddingX = samplePaddingX ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.wordHighlightPaddingX;
  const normalizedSamplePaddingY = samplePaddingY ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.wordHighlightPaddingY;
  const normalizedSampleBorderRadius = sampleBorderRadius ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.wordHighlightBorderRadius;
  const normalizedSampleWordSpacing = sampleWordSpacing ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.wordHighlightWordSpacing;
  const setRgbChannel = (index: 0 | 1 | 2, value: number) => {
    const next: [number, number, number] = [...rgb] as [number, number, number];
    next[index] = clampReelNumber(Math.round(value), 0, 255);
    onColorChange(reelRgbToHex(next));
  };

  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-neutral-900 px-3 py-2">
      <div className="flex items-center gap-2">
        {showSample ? (
          <span
            className="min-w-0 shrink-0 whitespace-nowrap font-sans text-[10px] font-semibold uppercase tracking-wider text-white"
            style={{ isolation: 'isolate' }}
          >
            {sampleText?.split(/\s+/).filter(Boolean).map((word, index) => (
              <span
                key={`${word}-${index}`}
                className="relative inline-block"
                style={{
                  marginLeft: index > 0 ? `${normalizedSampleWordSpacing - normalizedSamplePaddingX * 2}px` : undefined,
                  padding: `${normalizedSamplePaddingY}px ${normalizedSamplePaddingX}px`,
                }}
              >
                <span
                  aria-hidden
                  className="absolute"
                  style={{
                    backgroundColor: reelColorWithOpacity(color, opacity ?? 1),
                    borderRadius: `${normalizedSampleBorderRadius}px`,
                    inset: 0,
                    zIndex: -1,
                  }}
                />
                {word}
              </span>
            ))}
          </span>
        ) : (
          <span className="shrink-0 font-sans text-[10px] uppercase tracking-wider text-neutral-500">
            {label}
          </span>
        )}
        <button
          type="button"
          onClick={() => setPickerOpen((current) => !current)}
          aria-label={`${label} color picker`}
          aria-expanded={pickerOpen}
          className="h-7 w-8 shrink-0 rounded-lg border border-white/15 bg-neutral-950 p-1 shadow-inner transition-colors hover:border-emerald-400/50"
        >
          <span
            className="block h-full w-full rounded-md"
            style={{ backgroundColor: colorInputValue }}
          />
        </button>
        <input
          type="text"
          value={color ?? fallback}
          aria-label={`${label} hex color`}
          onChange={(event) => onColorChange(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 font-sans text-[11px] text-neutral-200 outline-none transition-colors focus:border-emerald-400/50"
        />
      </div>
      {onOpacityChange && (
        typeof blur === 'number' && onBlurChange ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <ReelIconSliderControl
              icon={Blend}
              label={`${label} opacity`}
              value={opacityPercent}
              min={0}
              max={100}
              step={5}
              onChange={(nextPercent) => onOpacityChange(normalizeOpacityInput(nextPercent / 100))}
            />
            <ReelIconSliderControl
              icon={Focus}
              label={`${label} blur`}
              value={blur}
              min={REEL_CAPTION_BACKGROUND_BLUR_MIN}
              max={REEL_CAPTION_BACKGROUND_BLUR_MAX}
              onChange={(nextBlur) => onBlurChange(Math.round(nextBlur))}
            />
          </div>
        ) : (
          <div className="mt-2">
            <ReelIconSliderControl
              icon={Blend}
              label={`${label} opacity`}
              value={opacityPercent}
              min={0}
              max={100}
              step={5}
              onChange={(nextPercent) => onOpacityChange(normalizeOpacityInput(nextPercent / 100))}
            />
          </div>
        )
      )}
      {typeof samplePaddingX === 'number'
        && typeof samplePaddingY === 'number'
        && typeof sampleBorderRadius === 'number'
        && typeof sampleWordSpacing === 'number'
        && onSamplePaddingXChange
        && onSamplePaddingYChange
        && onSampleBorderRadiusChange
        && onSampleWordSpacingChange
        && (
          <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(min(100%,7.5rem),1fr))] gap-2">
            <ReelIconSliderControl
              icon={UnfoldHorizontal}
              label={`${label} horizontal padding`}
              value={samplePaddingX}
              min={REEL_WORD_HIGHLIGHT_PADDING_X_MIN}
              max={REEL_WORD_HIGHLIGHT_PADDING_X_MAX}
              onChange={(nextPadding) => onSamplePaddingXChange(Math.round(nextPadding))}
            />
            <ReelIconSliderControl
              icon={UnfoldVertical}
              label={`${label} vertical padding`}
              value={samplePaddingY}
              min={REEL_WORD_HIGHLIGHT_PADDING_Y_MIN}
              max={REEL_WORD_HIGHLIGHT_PADDING_Y_MAX}
              onChange={(nextPadding) => onSamplePaddingYChange(Math.round(nextPadding))}
            />
            <ReelIconSliderControl
              icon={Radius}
              label={`${label} border radius`}
              value={sampleBorderRadius}
              min={REEL_WORD_HIGHLIGHT_RADIUS_MIN}
              max={REEL_WORD_HIGHLIGHT_RADIUS_MAX}
              onChange={(nextRadius) => onSampleBorderRadiusChange(Math.round(nextRadius))}
            />
            <ReelIconSliderControl
              icon={StretchHorizontal}
              label={`${label} word spacing`}
              value={sampleWordSpacing}
              min={REEL_WORD_HIGHLIGHT_WORD_SPACING_MIN}
              max={REEL_WORD_HIGHLIGHT_WORD_SPACING_MAX}
              onChange={(nextSpacing) => onSampleWordSpacingChange(Math.round(nextSpacing))}
            />
          </div>
        )}
      {pickerOpen && (
        <div className="mt-3 rounded-2xl border border-white/12 bg-neutral-950 p-3 shadow-2xl shadow-black/40">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="font-sans text-[10px] uppercase tracking-[0.22em] text-neutral-500">
              {label} color
            </span>
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="rounded-full border border-white/10 px-2 py-1 font-sans text-[10px] uppercase tracking-wider text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100"
            >
              Done
            </button>
          </div>
          <div className="mb-3 grid grid-cols-8 gap-1.5">
            {REEL_COLOR_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Use ${swatch}`}
                onClick={() => onColorChange(swatch)}
                className={`h-6 rounded-md border transition-transform hover:scale-110 ${
                  colorInputValue.toLowerCase() === swatch.toLowerCase()
                    ? 'border-emerald-300'
                    : 'border-white/15'
                }`}
                style={{ backgroundColor: swatch }}
              />
            ))}
          </div>
          <label className="mb-3 flex items-center gap-2">
            <span className="w-8 shrink-0 font-sans text-[10px] uppercase tracking-wider text-neutral-500">
              Hex
            </span>
            <input
              type="text"
              value={color ?? fallback}
              onChange={(event) => onColorChange(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 font-sans text-xs text-neutral-100 outline-none transition-colors focus:border-emerald-400/50"
            />
          </label>
          <div className="space-y-2">
            <ReelRgbChannelControl label="R" value={rgb[0]} onChange={(value) => setRgbChannel(0, value)} />
            <ReelRgbChannelControl label="G" value={rgb[1]} onChange={(value) => setRgbChannel(1, value)} />
            <ReelRgbChannelControl label="B" value={rgb[2]} onChange={(value) => setRgbChannel(2, value)} />
          </div>
        </div>
      )}
    </div>
  );
}
