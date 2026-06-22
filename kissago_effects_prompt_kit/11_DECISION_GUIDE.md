# Decision Guide for Choosing the Stack

Use this only after codebase discovery.

## Choose PixiJS-centered approach if:
- player can accommodate a render layer without major rewrite
- export parity matters strongly
- you want better long-term visual extensibility
- you need filters, blend modes, particles, and more deterministic rendering

## Choose DOM-first + tsParticles fallback if:
- current player is strongly DOM/CSS oriented
- product needs faster first release with lower integration risk
- export can still be made deterministic through browser automation
- team wants minimal change to current playback architecture

## Avoid if possible
- preview-only effect solutions that cannot be exported
- libraries that solve only a tiny slice but add runtime overhead
- over-engineered 3D solutions for a 2D still-image storytelling product

## Practical recommendation
Start by proving this pipeline on a small subset:
1. one story
2. one beat
3. one motion effect
4. one particle effect
5. one export test

If this works end-to-end, scale carefully.

