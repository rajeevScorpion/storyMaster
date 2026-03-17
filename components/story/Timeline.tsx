'use client';

import { StoryMap } from '@/lib/types/story';
import { getPathToNode } from '@/lib/utils/story-map';
import { motion } from 'motion/react';
import { GitBranch } from 'lucide-react';

interface TimelineProps {
  storyMap: StoryMap;
  onNodeClick: (nodeId: string) => void;
}

export default function Timeline({ storyMap, onNodeClick }: TimelineProps) {
  const path = getPathToNode(storyMap, storyMap.currentNodeId);

  if (path.length <= 1) return null;

  return (
    <div className="relative z-10 px-6 py-3">
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex items-center gap-1 min-w-max justify-center">
          {path.map((node, index) => {
            const isCurrent = node.id === storyMap.currentNodeId;
            const hasBranches = node.children.length > 1;
            const isLast = index === path.length - 1;

            return (
              <div key={node.id} className="flex items-center">
                {/* Node dot */}
                <button
                  onClick={() => onNodeClick(node.id)}
                  className="relative group flex flex-col items-center"
                  title={`Beat ${node.beatNumber}: ${node.data.title}`}
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: index * 0.05, type: 'spring', stiffness: 300 }}
                    className={`
                      rounded-full transition-all duration-200
                      ${isCurrent
                        ? 'w-5 h-5 bg-emerald-500 shadow-lg shadow-emerald-500/30 ring-2 ring-emerald-400/30'
                        : 'w-3.5 h-3.5 bg-neutral-500 hover:bg-neutral-300 cursor-pointer'
                      }
                    `}
                  />
                  {isCurrent && (
                    <motion.div
                      animate={{ scale: [1, 1.6, 1], opacity: [0.4, 0, 0.4] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute inset-0 rounded-full bg-emerald-500"
                    />
                  )}

                  {/* Beat number label */}
                  <span className={`text-[10px] mt-1.5 font-sans ${isCurrent ? 'text-emerald-400' : 'text-neutral-500 group-hover:text-neutral-300'} transition-colors`}>
                    {node.beatNumber}
                  </span>

                  {/* Branch indicator */}
                  {hasBranches && (
                    <GitBranch className="absolute -top-3 w-3 h-3 text-indigo-400" />
                  )}
                </button>

                {/* Connector line */}
                {!isLast && (
                  <div className="w-8 h-px bg-neutral-700 mx-1" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
