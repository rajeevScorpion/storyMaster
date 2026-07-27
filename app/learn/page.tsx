import type { Metadata } from 'next';

import LearnExperience from '@/components/learn/LearnExperience';

export const metadata: Metadata = {
  title: 'Kissago — Product and Partner Presentation',
  description:
    'Explore the opportunity, product, platform and partnership vision behind Kissago’s guided storytelling system.',
};

export default function LearnPage() {
  return <LearnExperience />;
}
