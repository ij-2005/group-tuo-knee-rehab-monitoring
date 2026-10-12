# Knee Rehab Monitoring System

AI-powered computer vision system for monitoring knee rehabilitation exercises
using MediaPipe Pose Estimation.

**Status:** v1 prototype — webcam access + square canvas display.

## Run locally

Open `index.html` in Chrome or Edge, or serve the folder:

    python -m http.server 8000

Then visit http://localhost:8000

## Roadmap

- [x] v1 — Webcam open/close, square center-cropped canvas
- [x] v2 — MediaPipe Pose landmark detection + overlay
- [ ] v3 — Knee angle calculation + real-time feedback
- [ ] v4 — Progress tracking + benchmarking evaluation