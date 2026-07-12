'use client';

import AuthProvider from '@/components/auth/AuthProvider';
import PricingRuntimeProvider from '@/components/pricing/PricingRuntimeProvider';
import DeploymentSkewGuard from '@/components/system/DeploymentSkewGuard';
import type { ReactNode } from 'react';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <PricingRuntimeProvider>
        {children}
        <DeploymentSkewGuard />
      </PricingRuntimeProvider>
    </AuthProvider>
  );
}
