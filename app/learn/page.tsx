import type { Metadata } from 'next';

import LearnExperience from '@/components/learn/LearnExperience';

export const metadata: Metadata = {
  title: 'Learn how Kissago works',
  description:
    'See how Kissago turns an idea into a narrated visual story through one guided creative journey.',
};

export default function LearnPage() {
  return <LearnExperience />;
}
