'use client';

import { StoryMap } from '@/lib/types/story';
import { getPathToNode } from '@/lib/utils/story-map';
import { motion } from 'motion/react';

interface TimelineProps {
  storyMap: StoryMap;
  onNodeClick: (nodeId: string) => void;
  focusedNodeId?: string;
}

export default function Timeline({ storyMap, onNodeClick, focusedNodeId }: TimelineProps) {
  const path = getPathToNode(storyMap, storyMap.currentNodeId);

  if (path.length <= 1) return null;

  return (
    <div className="flex items-center gap-1 justify-start py-3 px-4 flex-wrap">
      {path.map((node, index) => {
        const isCurrent = node.id === storyMap.currentNodeId;
        const isFocused = node.id === focusedNodeId;
        const isLast = index === path.length - 1;

        return (
          <div key={node.id} className="flex items-center">
            <button
              onClick={() => onNodeClick(node.id)}
              className="relative group"
              title={`Beat ${node.beatNumber}: ${node.data.title}`}
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: index * 0.05, type: 'spring', stiffness: 300 }}
                className={`
                  rounded-full flex items-center justify-center text-xs font-bold transition-all duration-200
                  ${isCurrent
                    ? 'w-8 h-8 bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
                    : 'w-7 h-7 bg-neutral-800 border border-neutral-600 text-neutral-400 hover:border-neutral-400 cursor-pointer'
                  }
                  ${isFocused ? 'ring-2 ring-white/50' : ''}
                `}
              >
                {node.beatNumber}
              </motion.div>

              {/* Pulsating ring for active node */}
              {isCurrent && (
                <motion.div
                  animate={{ scale: [1, 1.5, 1], opacity: [0.4, 0, 0.4] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute inset-0 rounded-full bg-emerald-500"
                />
              )}
            </button>

            {/* Connector line */}
            {!isLast && (
              <div className="w-4 h-px bg-neutral-700 mx-0.5" />
            )}
          </div>
        );
      })}
    </div>
  );
}
