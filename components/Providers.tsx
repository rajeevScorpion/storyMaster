'use client';

import AuthProvider from '@/components/auth/AuthProvider';
import PricingRuntimeProvider from '@/components/pricing/PricingRuntimeProvider';
import CrossOriginIsolationBoundary from '@/components/system/CrossOriginIsolationBoundary';
import DeploymentSkewGuard from '@/components/system/DeploymentSkewGuard';
import NavigationProgress from '@/components/system/NavigationProgress';
import type { ReactNode } from 'react';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <PricingRuntimeProvider>
        <NavigationProgress />
        <CrossOriginIsolationBoundary />
        {children}
        <DeploymentSkewGuard />
      </PricingRuntimeProvider>
    </AuthProvider>
  );
}
