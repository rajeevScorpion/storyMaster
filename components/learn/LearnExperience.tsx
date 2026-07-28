'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Expand,
  Minimize2,
  Play,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import KissagoLogo from '@/components/ui/KissagoLogo';
import {
  getLearnChapter,
  LEARN_CHAPTERS,
  LEARN_SCREENSHOT_ASSETS,
  LEARN_SLIDES,
} from '@/lib/learn/content';
import {
  clampLearnSlideIndex,
  findLearnSlideIndex,
  getLearnSlideHash,
} from '@/lib/learn/navigation';

import LearnVisual from './LearnVisual';
import styles from './learn.module.css';

const NAV_BUTTON_CLASS =
  'inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/10 bg-neutral-950/65 px-4 text-sm text-neutral-300 shadow-lg shadow-black/15 backdrop-blur-md transition-colors hover:border-emerald-300/25 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-30';

const PRIMARY_ACTION_CLASS =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-emerald-300 px-6 text-sm font-semibold text-neutral-950 shadow-[0_10px_40px_rgba(52,211,153,0.2)] transition-colors hover:bg-emerald-200';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

export default function LearnExperience() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const activeIndexRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const wheelResetTimerRef = useRef<number | null>(null);
  const wheelAccumulatorRef = useRef(0);
  const wheelLockUntilRef = useRef(0);
  const reducedMotion = useReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPresenting, setIsPresenting] = useState(false);

  const currentSlide = LEARN_SLIDES[activeIndex] ?? LEARN_SLIDES[0];
  const currentChapter = getLearnChapter(currentSlide.chapter);

  const commitUrl = useCallback((index: number, mode: 'push' | 'replace') => {
    if (typeof window === 'undefined') return;

    const target = LEARN_SLIDES[clampLearnSlideIndex(index, LEARN_SLIDES.length)];
    const url = new URL(window.location.href);
    url.hash = getLearnSlideHash(target);

    const state = {
      ...(window.history.state ?? {}),
      kissagoLearnIndex: target.index,
    };

    if (mode === 'push') {
      window.history.pushState(state, '', url);
    } else {
      window.history.replaceState(state, '', url);
    }
  }, []);

  const goToSlide = useCallback(
    (index: number, historyMode: 'push' | 'replace' = 'push') => {
      const targetIndex = clampLearnSlideIndex(index, LEARN_SLIDES.length);
      const viewport = viewportRef.current;
      if (!viewport) return;

      activeIndexRef.current = targetIndex;
      setActiveIndex(targetIndex);
      viewport.scrollTo({
        left: targetIndex * viewport.clientWidth,
        behavior: reducedMotion ? 'auto' : 'smooth',
      });
      commitUrl(targetIndex, historyMode);
    },
    [commitUrl, reducedMotion]
  );

  const handleViewportScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || viewport.clientWidth === 0) return;

    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      const nextIndex = clampLearnSlideIndex(
        viewport.scrollLeft / viewport.clientWidth,
        LEARN_SLIDES.length
      );

      if (nextIndex !== activeIndexRef.current) {
        activeIndexRef.current = nextIndex;
        setActiveIndex(nextIndex);
      }

      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }

      settleTimerRef.current = window.setTimeout(() => {
        commitUrl(activeIndexRef.current, 'replace');
      }, 140);
    });
  }, [commitUrl]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const initialIndex = findLearnSlideIndex(
      window.location.hash,
      LEARN_SLIDES,
      LEARN_CHAPTERS
    );
    const initialPresentationMode = new URL(window.location.href).searchParams.get('present') === '1';

    activeIndexRef.current = initialIndex;
    const previousScrollBehavior = viewport.style.scrollBehavior;
    viewport.style.scrollBehavior = 'auto';
    viewport.scrollLeft = initialIndex * viewport.clientWidth;

    if (!window.location.hash) {
      commitUrl(initialIndex, 'replace');
    }

    const frameId = window.requestAnimationFrame(() => {
      viewport.style.scrollBehavior = previousScrollBehavior;
      setActiveIndex(initialIndex);
      setIsPresenting(initialPresentationMode);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      viewport.style.scrollBehavior = previousScrollBehavior;
    };
  }, [commitUrl]);

  useEffect(() => {
    const handleHistoryNavigation = () => {
      const targetIndex = findLearnSlideIndex(
        window.location.hash,
        LEARN_SLIDES,
        LEARN_CHAPTERS
      );
      const presentationMode = new URL(window.location.href).searchParams.get('present') === '1';
      setIsPresenting(presentationMode);

      const viewport = viewportRef.current;
      if (!viewport) return;

      activeIndexRef.current = targetIndex;
      setActiveIndex(targetIndex);
      viewport.scrollTo({
        left: targetIndex * viewport.clientWidth,
        behavior: reducedMotion ? 'auto' : 'smooth',
      });
    };

    window.addEventListener('popstate', handleHistoryNavigation);
    window.addEventListener('hashchange', handleHistoryNavigation);
    return () => {
      window.removeEventListener('popstate', handleHistoryNavigation);
      window.removeEventListener('hashchange', handleHistoryNavigation);
    };
  }, [reducedMotion]);

  useEffect(() => {
    const handleResize = () => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const previousScrollBehavior = viewport.style.scrollBehavior;
      viewport.style.scrollBehavior = 'auto';
      viewport.scrollLeft = activeIndexRef.current * viewport.clientWidth;
      viewport.style.scrollBehavior = previousScrollBehavior;
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (event.key === 'Escape' && isPresenting) {
        event.preventDefault();
        const url = new URL(window.location.href);
        url.searchParams.delete('present');
        window.history.replaceState(window.history.state, '', url);
        setIsPresenting(false);
        return;
      }

      const keyTargets: Record<string, number> = {
        ArrowLeft: activeIndexRef.current - 1,
        ArrowRight: activeIndexRef.current + 1,
        PageUp: activeIndexRef.current - 1,
        PageDown: activeIndexRef.current + 1,
        Home: 0,
        End: LEARN_SLIDES.length - 1,
      };

      const target = keyTargets[event.key];
      if (target === undefined) return;

      event.preventDefault();
      goToSlide(target);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToSlide, isPresenting]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) * 0.8) {
        return;
      }

      const direction = Math.sign(event.deltaY);
      if (!direction) return;

      const targetSlide = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        '[data-learn-slide]'
      );
      if (targetSlide) {
        const canContinueVertically =
          direction > 0
            ? targetSlide.scrollTop + targetSlide.clientHeight < targetSlide.scrollHeight - 2
            : targetSlide.scrollTop > 2;
        if (canContinueVertically) return;
      }

      const atStart = activeIndexRef.current === 0 && direction < 0;
      const atEnd = activeIndexRef.current === LEARN_SLIDES.length - 1 && direction > 0;
      if (atStart || atEnd) return;

      event.preventDefault();
      wheelAccumulatorRef.current += event.deltaY;

      if (wheelResetTimerRef.current !== null) {
        window.clearTimeout(wheelResetTimerRef.current);
      }
      wheelResetTimerRef.current = window.setTimeout(() => {
        wheelAccumulatorRef.current = 0;
      }, 180);

      if (
        Math.abs(wheelAccumulatorRef.current) >= 48 &&
        Date.now() >= wheelLockUntilRef.current
      ) {
        wheelLockUntilRef.current = Date.now() + 520;
        wheelAccumulatorRef.current = 0;
        goToSlide(activeIndexRef.current + direction);
      }
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [goToSlide]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
      if (wheelResetTimerRef.current !== null) window.clearTimeout(wheelResetTimerRef.current);
    };
  }, []);

  const togglePresentationMode = () => {
    const nextMode = !isPresenting;
    const url = new URL(window.location.href);
    if (nextMode) {
      url.searchParams.set('present', '1');
    } else {
      url.searchParams.delete('present');
    }
    window.history.replaceState(window.history.state, '', url);
    setIsPresenting(nextMode);
  };

  return (
    <main
      className={`${styles.page} ${isPresenting ? styles.present : ''} selection:bg-emerald-400/30`}
    >
      <header className={styles.topBar}>
        <div className="justify-self-start">
          <KissagoLogo fixed={false} />
        </div>

        <nav className={styles.chapterNav} aria-label="Learn chapters">
          {LEARN_CHAPTERS.map((chapter) => {
            const isActive = chapter.id === currentSlide.chapter;
            return (
              <button
                key={chapter.id}
                type="button"
                onClick={() => goToSlide(chapter.range[0] - 1)}
                aria-current={isActive ? 'step' : undefined}
                className={`rounded-full px-4 py-2 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-emerald-400/10 text-emerald-200'
                    : 'text-neutral-500 hover:bg-white/[0.04] hover:text-neutral-200'
                }`}
              >
                {chapter.title}
              </button>
            );
          })}
        </nav>

        <div className={styles.topActions}>
          <Link
            href="/"
            className={`${NAV_BUTTON_CLASS} learn-secondary-action ${styles.topActionLabel}`}
          >
            Experience product
            <ArrowRight className="h-4 w-4" />
          </Link>
          <button
            type="button"
            onClick={togglePresentationMode}
            aria-pressed={isPresenting}
            aria-label={isPresenting ? 'Exit presentation mode' : 'Enter presentation mode'}
            className={`${NAV_BUTTON_CLASS} w-11 px-0`}
          >
            {isPresenting ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <div
        className={styles.chapterProgress}
        style={{
          gridTemplateColumns: LEARN_CHAPTERS
            .map((chapter) => `${chapter.range[1] - chapter.range[0] + 1}fr`)
            .join(' '),
        }}
        aria-hidden="true"
      >
        {LEARN_CHAPTERS.map((chapter) => {
          const [start, end] = chapter.range;
          const progress =
            currentSlide.index < start
              ? 0
              : currentSlide.index > end
                ? 100
                : ((currentSlide.index - start + 1) / (end - start + 1)) * 100;
          return (
            <div key={chapter.id} className={styles.chapterProgressTrack}>
              <span className={styles.chapterProgressFill} style={{ width: `${progress}%` }} />
            </div>
          );
        })}
      </div>

      <div
        ref={viewportRef}
        className={styles.viewport}
        onScroll={handleViewportScroll}
        aria-label="Kissago collaborator and investor presentation"
      >
        {LEARN_SLIDES.map((slide, index) => {
          const isActive = index === activeIndex;
          const isEmber = slide.accent === 'ember';
          const hasMeaningfulScreenshot = Boolean(
            slide.screenshotKey && LEARN_SCREENSHOT_ASSETS[slide.screenshotKey]
          );
          const titleIsCompact =
            slide.title.length > 58 || slide.visualType === 'story-equation';
          const TitleTag = index === 0 ? 'h1' : 'h2';

          return (
            <section
              key={slide.id}
              id={`slide-${String(slide.index).padStart(2, '0')}`}
              data-learn-slide
              className={styles.slide}
              aria-roledescription="slide"
              aria-label={`${slide.index} of ${LEARN_SLIDES.length}: ${slide.title}`}
              aria-hidden={!isActive}
              inert={!isActive}
            >
              {slide.background ? (
                <div className={styles.background} aria-hidden="true">
                  <Image
                    src={slide.background}
                    alt=""
                    fill
                    priority={index <= 1}
                    sizes="100vw"
                    className={styles.backgroundImage}
                    style={{ objectPosition: slide.backgroundPosition ?? 'center' }}
                  />
                </div>
              ) : null}
              <div className={styles.backgroundShade} aria-hidden="true" />
              <div
                className={`${styles.ambient} ${styles.ambientEmerald}`}
                aria-hidden="true"
              />
              {slide.accent !== 'emerald' ? (
                <div
                  className={`${styles.ambient} ${styles.ambientEmber}`}
                  aria-hidden="true"
                />
              ) : null}

              <div className={styles.slideInner}>
                <motion.div
                  className={styles.copy}
                  initial={false}
                  animate={
                    reducedMotion
                      ? { opacity: 1 }
                      : isActive
                        ? { opacity: 1, y: 0 }
                        : { opacity: 0.36, y: 16 }
                  }
                  transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                >
                  <p className={`${styles.eyebrow} ${isEmber ? styles.eyebrowEmber : ''}`}>
                    {slide.eyebrow}
                  </p>
                  <TitleTag
                    className={`${styles.title} ${titleIsCompact ? styles.titleCompact : ''}`}
                  >
                    {slide.title}
                  </TitleTag>
                  <p className={styles.body}>{slide.body}</p>

                  {slide.supportingPoints?.length ? (
                    <ul className="sr-only">
                      {slide.supportingPoints.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  ) : null}

                  {slide.expandableDetail ? (
                    <details className={styles.detail}>
                      <summary>More context</summary>
                      <p>{slide.expandableDetail}</p>
                    </details>
                  ) : null}

                  {slide.visualType === 'cta' || slide.visualType === 'collaboration-ask' ? (
                    <div className={styles.ctaRow}>
                      <Link href="/" className={PRIMARY_ACTION_CLASS}>
                        Experience product
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                      <Link
                        href="/gallery"
                        className={`${NAV_BUTTON_CLASS} min-h-12 px-6`}
                      >
                        <Play className="h-4 w-4" />
                        Explore community stories
                      </Link>
                    </div>
                  ) : null}
                </motion.div>

                <motion.div
                  className={styles.visual}
                  aria-hidden={!hasMeaningfulScreenshot}
                  initial={false}
                  animate={
                    reducedMotion
                      ? { opacity: 1 }
                      : isActive
                        ? { opacity: 1, x: 0, scale: 1 }
                        : { opacity: 0.25, x: 20, scale: 0.985 }
                  }
                  transition={{ duration: 0.52, delay: isActive ? 0.06 : 0, ease: [0.22, 1, 0.36, 1] }}
                >
                  <LearnVisual slide={slide} />
                </motion.div>
              </div>
            </section>
          );
        })}
      </div>

      <div className={styles.bottomBar}>
        <div className={styles.slideMeta} aria-live="polite" aria-atomic="true">
          <span>
            {String(currentSlide.index).padStart(2, '0')} / {LEARN_SLIDES.length}
          </span>
          <span>{currentChapter.shortTitle}</span>
        </div>

        <div className={styles.slideProgress} aria-hidden="true">
          <div
            className={styles.slideProgressFill}
            style={{ width: `${(currentSlide.index / LEARN_SLIDES.length) * 100}%` }}
          />
        </div>

        <div className={styles.navControls}>
          <button
            type="button"
            onClick={() => goToSlide(activeIndex - 1)}
            disabled={activeIndex === 0}
            className={`${NAV_BUTTON_CLASS} w-11 px-0`}
            aria-label="Previous slide"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => goToSlide(activeIndex + 1)}
            disabled={activeIndex === LEARN_SLIDES.length - 1}
            className={`${NAV_BUTTON_CLASS} w-11 px-0`}
            aria-label="Next slide"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </main>
  );
}
