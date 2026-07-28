import type { LearnChapter, LearnSlide } from './content';

function normalizeHash(hash: string): string {
  const value = hash.trim().replace(/^#/, '');

  try {
    return decodeURIComponent(value).toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

export function getLearnSlideHash(slide: Pick<LearnSlide, 'index'>): string {
  return `#slide-${String(slide.index).padStart(2, '0')}`;
}

export function findLearnSlideIndex(
  hash: string,
  slides: readonly LearnSlide[],
  chapters: readonly LearnChapter[]
): number {
  const target = normalizeHash(hash);
  if (!target) return 0;

  const exactSlideIndex = slides.findIndex((slide) => slide.id.toLowerCase() === target);
  if (exactSlideIndex >= 0) return exactSlideIndex;

  const chapter = chapters.find((item) => item.id === target);
  if (chapter) {
    const chapterIndex = slides.findIndex((slide) => slide.chapter === chapter.id);
    return chapterIndex >= 0 ? chapterIndex : 0;
  }

  const numberedSlide = /^slide-(\d{1,2})$/.exec(target);
  if (numberedSlide) {
    const requestedIndex = Number(numberedSlide[1]) - 1;
    if (Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < slides.length) {
      return requestedIndex;
    }
  }

  return 0;
}

export function clampLearnSlideIndex(index: number, slideCount: number): number {
  if (slideCount <= 0) return 0;
  return Math.min(Math.max(Math.round(index), 0), slideCount - 1);
}
