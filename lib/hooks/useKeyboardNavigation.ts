import { useState, useEffect, useCallback } from 'react';
import { StoryMap, Option } from '@/lib/types/story';
import { getPathToNode } from '@/lib/utils/story-map';

type FocusMode = 'timeline' | 'options' | null;

interface UseKeyboardNavigationProps {
  storyMap: StoryMap;
  options: Option[];
  onNavigateNode: (nodeId: string) => void;
  onSelectOption: (optionId: string) => void;
  onSetMinimized: (minimized: boolean) => void;
  onToggleNarration?: () => void;
  isLoading: boolean;
  isEnding: boolean;
}

interface UseKeyboardNavigationResult {
  focusedOptionIndex: number;
  focusMode: FocusMode;
}

export function useKeyboardNavigation({
  storyMap,
  options,
  onNavigateNode,
  onSelectOption,
  onSetMinimized,
  onToggleNarration,
  isLoading,
  isEnding,
}: UseKeyboardNavigationProps): UseKeyboardNavigationResult {
  // Key state on currentNodeId to auto-reset when node changes
  const [focusState, setFocusState] = useState<{
    nodeId: string;
    optionIndex: number;
    mode: FocusMode;
  }>({ nodeId: storyMap.currentNodeId, optionIndex: -1, mode: null });

  // Derive values — reset if node changed
  const isStale = focusState.nodeId !== storyMap.currentNodeId;
  const focusedOptionIndex = isStale ? -1 : focusState.optionIndex;
  const focusMode = isStale ? null : focusState.mode;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isLoading) return;

      const path = getPathToNode(storyMap, storyMap.currentNodeId);
      const currentIndex = path.findIndex((n) => n.id === storyMap.currentNodeId);

      switch (e.key) {
        case 'ArrowLeft': {
          e.preventDefault();
          setFocusState({ nodeId: storyMap.currentNodeId, optionIndex: -1, mode: 'timeline' });
          if (currentIndex > 0) {
            onNavigateNode(path[currentIndex - 1].id);
          }
          break;
        }

        case 'ArrowRight': {
          e.preventDefault();
          setFocusState({ nodeId: storyMap.currentNodeId, optionIndex: -1, mode: 'timeline' });
          if (currentIndex < path.length - 1) {
            onNavigateNode(path[currentIndex + 1].id);
          }
          break;
        }

        case 'ArrowDown': {
          e.preventDefault();
          if (isEnding) break;
          setFocusState((prev) => {
            const currentOptIndex = prev.nodeId === storyMap.currentNodeId ? prev.optionIndex : -1;
            const next = currentOptIndex + 1;
            return {
              nodeId: storyMap.currentNodeId,
              optionIndex: next >= options.length ? options.length - 1 : next,
              mode: 'options',
            };
          });
          break;
        }

        case 'ArrowUp': {
          e.preventDefault();
          const currentMode = focusState.nodeId === storyMap.currentNodeId ? focusState.mode : null;
          if (currentMode === 'options') {
            setFocusState((prev) => {
              const currentOptIndex = prev.nodeId === storyMap.currentNodeId ? prev.optionIndex : 0;
              if (currentOptIndex <= 0) {
                return { nodeId: storyMap.currentNodeId, optionIndex: -1, mode: 'timeline' };
              }
              return { nodeId: storyMap.currentNodeId, optionIndex: currentOptIndex - 1, mode: 'options' };
            });
          }
          break;
        }

        case 'Enter': {
          const currentFocusedIndex = focusState.nodeId === storyMap.currentNodeId ? focusState.optionIndex : -1;
          const currentFocusMode = focusState.nodeId === storyMap.currentNodeId ? focusState.mode : null;
          if (currentFocusMode === 'options' && currentFocusedIndex >= 0 && currentFocusedIndex < options.length) {
            e.preventDefault();
            onSelectOption(options[currentFocusedIndex].id);
          }
          break;
        }

        case 'Escape': {
          setFocusState({ nodeId: storyMap.currentNodeId, optionIndex: -1, mode: null });
          break;
        }

        case 'm': {
          onSetMinimized(false);
          break;
        }

        case 'n': {
          onSetMinimized(true);
          break;
        }

        case 'p': {
          e.preventDefault();
          onToggleNarration?.();
          break;
        }
      }
    },
    [storyMap, options, onNavigateNode, onSelectOption, onSetMinimized, onToggleNarration, isLoading, isEnding, focusState]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return { focusedOptionIndex, focusMode };
}
