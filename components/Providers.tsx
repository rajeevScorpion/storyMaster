'use client';

import AuthProvider from '@/components/auth/AuthProvider';
import PricingRuntimeProvider from '@/components/pricing/PricingRuntimeProvider';
import DeploymentSkewGuard from '@/components/system/DeploymentSkewGuard';
import NavigationProgress from '@/components/system/NavigationProgress';
import type { ReactNode } from 'react';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <PricingRuntimeProvider>
        <NavigationProgress />
        {children}
        <DeploymentSkewGuard />
      </PricingRuntimeProvider>
    </AuthProvider>
  );
}
