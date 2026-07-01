import 'server-only';

import { callGeminiImage, callGeminiInteractionsImage } from '@/app/actions/gemini-proxy';
import { createImageContinuityState } from '@/lib/ai/image-continuity.shared';
import { geminiBatchAdapter } from './gemini-batch';
import type { ImageProviderAdapter } from './types';

export const geminiImageProvider: ImageProviderAdapter = {
  batch: geminiBatchAdapter,
  async generateImage(request) {
    if (request.continuity?.strategy === 'provider_stateful' && request.continuity.stateKind === 'gemini_interactions') {
      try {
        const statefulResult = await callGeminiInteractionsImage({
          task: request.task,
          model: request.continuity.runtimeModelId || request.modelSnapshot.providerModelId,
          prompt: request.prompt,
          referenceParts: request.referenceParts,
          aspectRatio: request.aspectRatio,
          imageSize: request.imageSize,
          previousInteractionId: request.continuity.previousState?.stateOutputId ?? null,
        });

        if (statefulResult.dataUrl) {
          const continuityState = createImageContinuityState({
            provider: 'gemini',
            requestedStrategy: request.continuity.requestedStrategy,
            strategy: 'provider_stateful',
            stateKind: 'gemini_interactions',
            previousStateId: request.continuity.previousState?.stateOutputId ?? null,
            stateOutputId: statefulResult.interactionId,
            runtimeModelId: request.continuity.runtimeModelId || request.modelSnapshot.providerModelId,
            usage: statefulResult.providerUsage ?? null,
          });
          return {
            dataUrl: statefulResult.dataUrl,
            fallbackText: null,
            providerUsage: statefulResult.providerUsage,
            inputImageCount: request.referenceParts?.length ?? 0,
            continuityState,
            resolvedContinuityStrategy: 'provider_stateful',
            metadata: {
              provider: 'gemini',
              providerModelId: request.modelSnapshot.providerModelId,
              providerTelemetryMode: 'gemini_interactions',
              continuityStrategy: request.continuity.requestedStrategy,
              resolvedContinuityStrategy: 'provider_stateful',
              statefulProvider: 'gemini',
              stateKind: 'gemini_interactions',
              stateInputId: request.continuity.previousState?.stateOutputId ?? null,
              stateOutputId: continuityState.stateOutputId,
              runtimeModelId: continuityState.runtimeModelId,
              providerUsage: statefulResult.providerUsage,
            },
          };
        }

        if (!request.continuity.allowRuntimeFallback) {
          return {
            dataUrl: null,
            fallbackText: statefulResult.fallbackText,
            providerUsage: statefulResult.providerUsage,
            resolvedContinuityStrategy: 'provider_stateful',
            metadata: {
              provider: 'gemini',
              providerModelId: request.modelSnapshot.providerModelId,
              providerTelemetryMode: 'gemini_interactions',
              continuityStrategy: request.continuity.requestedStrategy,
              resolvedContinuityStrategy: 'provider_stateful',
              statefulProvider: 'gemini',
              stateKind: 'gemini_interactions',
              stateInputId: request.continuity.previousState?.stateOutputId ?? null,
              runtimeModelId: request.continuity.runtimeModelId || request.modelSnapshot.providerModelId,
              providerUsage: statefulResult.providerUsage,
            },
          };
        }
      } catch (error) {
        if (!request.continuity.allowRuntimeFallback) throw error;
      }
    }

    const result = await callGeminiImage({
      task: request.task,
      model: request.modelSnapshot.providerModelId,
      prompt: request.prompt,
      referenceParts: request.referenceParts,
      aspectRatio: request.aspectRatio,
      imageSize: request.imageSize,
      telemetry: request.telemetry,
    });

    return {
      dataUrl: result.dataUrl,
      fallbackText: result.fallbackText,
      inputImageCount: request.referenceParts?.length ?? 0,
      resolvedContinuityStrategy: request.continuity?.strategy === 'provider_stateful'
        ? 'resend_refs'
        : request.continuity?.strategy,
      fallbackReason: request.continuity?.strategy === 'provider_stateful'
        ? 'gemini_interactions_fallback'
        : null,
      metadata: {
        provider: 'gemini',
        providerModelId: request.modelSnapshot.providerModelId,
        continuityStrategy: request.continuity?.requestedStrategy ?? null,
        resolvedContinuityStrategy: request.continuity?.strategy === 'provider_stateful'
          ? 'resend_refs'
          : request.continuity?.strategy ?? null,
        fallbackStrategy: request.continuity?.strategy === 'provider_stateful' ? 'resend_refs' : null,
        fallbackReason: request.continuity?.strategy === 'provider_stateful'
          ? 'gemini_interactions_fallback'
          : null,
      },
    };
  },
};
