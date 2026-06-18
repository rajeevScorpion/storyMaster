'use client';

import { useState } from 'react';
import OpenFlowLoader from '@/components/story/OpenFlowLoader';
import { readOpenFlowNavMeta } from '@/lib/story/open-flow-nav';

export default function StorylineLoading() {
  const [meta] = useState(() => readOpenFlowNavMeta('storyline'));

  return (
    <OpenFlowLoader
      kind="storyline"
      title={meta?.title}
      coverImageUrl={meta?.coverImageUrl}
      coverIsStoryboard={meta?.coverIsStoryboard}
      beatCount={meta?.beatCount}
    />
  );
}
