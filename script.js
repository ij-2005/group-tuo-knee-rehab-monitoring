import {
  FilesetResolver,
  PoseLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/vision_bundle.mjs";

// ------------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------------

const MP_VERSION = "0.10.12";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const SMOOTHING = 0.7;
const MIN_VISIBILITY = 0.5;

const DOWN_HOLD_MS = 100;
const UP_HOLD_MS = 100;

const POSE_LOST_RESET_FRAMES = 15;
const MAX_REP_DURATION_MS = 8000;

const FLASH_DURATION_MS = 2500;

// ------------------------------------------------------------
// ANTI-CHEAT / POSTURE VALIDATION
// ------------------------------------------------------------

const MIN_HIP_DROP_RATIO = 0.12;
const MAX_TORSO_TILT_DEG = 35;
const BASELINE_HOLD_MS = 800;
const BASELINE_LOST_FRAMES = 30;

// ------------------------------------------------------------
// EXERCISE DEFINITIONS
// ------------------------------------------------------------

const EXERCISES = {
  squat: {
    id: "squat",
    name: "Squat",
    downAngle: 120,
    upAngle: 165,

    measure(points) {
      const lHip = points[23], rHip = points[24];
      const lKnee = points[25], rKnee = points[26];
      const lAnkle = points[27], rAnkle = points[28];

      if (!lHip || !rHip || !lKnee || !rKnee || !lAnkle || !rAnkle) {
        return null;
      }

      const lAngle = calculateAngle(lHip, lKnee, lAnkle);
      const rAngle = calculateAngle(rHip, rKnee, rAnkle);

      if (lAngle === null || rAngle === null) return null;

      return { left: lAngle, right: rAngle, avg: (lAngle + rAngle) / 2 };
    },

    feedback(angle, state) {
      if (angle === null) return "Adjust your position";
      if (state === "UP" && angle < 160) return "Stand tall";
      if (state === "DOWN" && angle > 100) return "Go deeper";
      if (state === "DOWN") return "Good depth — now stand";
      return "Ready";
    }
  }
};

let currentExercise = EXERCISES.squat;

// ------------------------------------------------------------
// DOM ELEMENTS
// ------------------------------------------------------------

const sourceVideo = document.getElementById("sourceVideo");
const stageCanvas = document.getElementById("stageCanvas");
const stageMessage = document.getElementById("stageMessage");

const openBtn = document.getElementById("openBtn");
const closeBtn = document.getElementById("closeBtn");
const exportBtn = document.getElementById("exportBtn");

const statusEl = document.getElementById("status");
const mpStatusEl = document.getElementById("mpStatus");

const repCountEl = document.getElementById("repCount");
const repStateEl = document.getElementById("repState");
const angleValueEl = document.getElementById("angleValue");
const lrAnglesEl = document.getElementById("lrAngles");

const feedbackEl = document.getElementById("feedback");
const flashEl = document.getElementById("flash");
const flashTextEl = document.getElementById("flashText");

const targetRepsEl = document.getElementById("targetReps");
const progressBarEl = document.getElementById("progressBar");
const progressTextEl = document.getElementById("progressText");
const progressStatusEl = document.getElementById("progressStatus");

const lastCommentEl = document.getElementById("lastComment");
const lastCommentTextEl = document.getElementById("lastCommentText");

const sessionCompleteEl = document.getElementById("sessionComplete");

const evalStatusEl = document.getElementById("evalStatus");
const evalDepthEl = document.getElementById("evalDepth");
const evalTempoEl = document.getElementById("evalTempo");
const evalRangeEl = document.getElementById("evalRange");
const evalOverallEl = document.getElementById("evalOverall");
const evalMinAngleEl = document.getElementById("evalMinAngle");
const evalMaxAngleEl = document.getElementById("evalMaxAngle");
const evalDurationEl = document.getElementById("evalDuration");
const evalReasonEl = document.getElementById("evalReason");

const ctx = stageCanvas.getContext("2d");

// ------------------------------------------------------------
// STATE
// ------------------------------------------------------------

let stream = null;
let rafId = null;
let poseLandmarker = null;

let modelReady = false;
let cameraStarting = false;
let cameraSession = 0;

let lastVideoTime = -1;
let latestLandmarks = null;

let previousPoints = {};
let missingFramesByLandmark = {};

let squatCount = 0;
let squatState = "UP";

let leftKneeAngle = null;
let rightKneeAngle = null;

let downSince = null;
let upSince = null;

let poseLostFrames = 0;
let repStartTime = null;

let repMinAngle = null;
let repMaxAngle = null;

let sessionLog = [];
let sessionStartTime = null;

let flashUntil = 0;

// Anti-cheat baseline
let standingHipY = null;
let baselineLegLength = null;
let standingSince = null;
let baselineLostFrames = 0;

// Evaluation snapshot state
let lastEvaluation = null;
let lastEvaluationAt = 0;

// Target + progress
let targetReps = 10;
let sessionCompleteShown = false;

// ------------------------------------------------------------
// LANDMARK MAPS
// ------------------------------------------------------------

const LOWER_BODY_INDICES = [11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
const DRAWN_JOINT_INDICES = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

const LOWER_BODY_CONNECTIONS = [
  [23, 25], [25, 27],
  [24, 26], [26, 28],
  [23, 24], [25, 26],
  [27, 28], [27, 29],
  [28, 30], [29, 31],
  [30, 32]
];

// ------------------------------------------------------------
// UI HELPERS
// ------------------------------------------------------------

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

function setMpStatus(message, isError = false) {
  mpStatusEl.textContent = message;
  mpStatusEl.classList.toggle("is-error", isError);
}

function setCameraUi(isOn) {
  openBtn.disabled = isOn || cameraStarting;
  closeBtn.disabled = !isOn && !cameraStarting;
  stageMessage.classList.toggle("is-hidden", isOn);
}

function updatePanel() {
  repCountEl.textContent = String(squatCount);
  repStateEl.textContent = squatState;

  angleValueEl.textContent =
    leftKneeAngle !== null && rightKneeAngle !== null
      ? `${Math.round((leftKneeAngle + rightKneeAngle) / 2)}°`
      : "--";

  lrAnglesEl.textContent =
    `${leftKneeAngle === null ? "--" : Math.round(leftKneeAngle) + "°"} / ` +
    `${rightKneeAngle === null ? "--" : Math.round(rightKneeAngle) + "°"}`;

  const avg =
    leftKneeAngle !== null && rightKneeAngle !== null
      ? (leftKneeAngle + rightKneeAngle) / 2
      : null;

  feedbackEl.textContent = currentExercise.feedback(avg, squatState);
}

function updateProgress() {
  const pct = targetReps > 0
    ? Math.min(100, (squatCount / targetReps) * 100)
    : 0;

  progressBarEl.style.width = `${pct}%`;
  progressTextEl.textContent = `${squatCount} / ${targetReps}`;

  const done = squatCount >= targetReps;

  progressBarEl.classList.toggle("is-complete", done);
  progressStatusEl.classList.toggle("is-complete", done);
  progressStatusEl.textContent = done ? "Complete" : "In progress";

  if (done && !sessionCompleteShown) {
    sessionCompleteEl.classList.remove("is-hidden");
    sessionCompleteShown = true;
  } else if (!done) {
    sessionCompleteEl.classList.add("is-hidden");
    sessionCompleteShown = false;
  }
}

function showFlash(text, grade) {
  flashTextEl.textContent = text;
  flashEl.classList.remove("is-hidden", "flash--good", "flash--fair", "flash--poor");
  if (grade) flashEl.classList.add(`flash--${grade}`);
  flashUntil = performance.now() + FLASH_DURATION_MS;
}

function updateFlashVisibility(now) {
  if (flashUntil === 0) return;
  if (now > flashUntil) {
    flashEl.classList.add("is-hidden");
    flashUntil = 0;
  }
}

function escapeCsv(str) {
  return String(str || "").replace(/"/g, '""');
}

// ------------------------------------------------------------
// STATE RESET HELPERS
// ------------------------------------------------------------

function resetRepState() {
  downSince = null;
  upSince = null;
  poseLostFrames = 0;
  repStartTime = null;
  repMinAngle = null;
  repMaxAngle = null;
}

function resetTrackingState() {
  previousPoints = {};
  missingFramesByLandmark = {};

  latestLandmarks = null;
  lastVideoTime = -1;

  leftKneeAngle = null;
  rightKneeAngle = null;

  squatState = "UP";
  resetRepState();

  standingHipY = null;
  baselineLegLength = null;
  standingSince = null;
  baselineLostFrames = 0;

  lastEvaluation = null;
  lastEvaluationAt = 0;

  lastCommentEl.classList.add("is-hidden");
  lastCommentTextEl.textContent = "";

  sessionCompleteEl.classList.add("is-hidden");
  sessionCompleteShown = false;

  updateEvaluationPanel(null);
}

// ------------------------------------------------------------
// MEDIAPIPE INIT
// ------------------------------------------------------------

async function initPoseLandmarker() {
  if (poseLandmarker) return poseLandmarker;

  const vision = await FilesetResolver.forVisionTasks(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
  );

  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.7
  });

  return poseLandmarker;
}

// ------------------------------------------------------------
// GEOMETRY
// ------------------------------------------------------------

function calculateAngle(a, b, c) {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;

  const dot = abx * cbx + aby * cby;
  const magAB = Math.hypot(abx, aby);
  const magCB = Math.hypot(cbx, cby);

  if (magAB < 1e-6 || magCB < 1e-6) return null;

  let cosine = dot / (magAB * magCB);
  cosine = Math.max(-1, Math.min(1, cosine));

  return Math.acos(cosine) * (180 / Math.PI);
}

function isLandmarkVisible(landmark) {
  return Boolean(
    landmark &&
    Number.isFinite(landmark.x) &&
    Number.isFinite(landmark.y) &&
    (landmark.visibility === undefined ||
      landmark.visibility >= MIN_VISIBILITY)
  );
}

function smoothPoint(index, rawX, rawY) {
  if (missingFramesByLandmark[index] > POSE_LOST_RESET_FRAMES) {
    previousPoints[index] = { x: rawX, y: rawY };
  }
  missingFramesByLandmark[index] = 0;

  if (!previousPoints[index]) {
    previousPoints[index] = { x: rawX, y: rawY };
    return previousPoints[index];
  }

  previousPoints[index].x =
    previousPoints[index].x * SMOOTHING + rawX * (1 - SMOOTHING);
  previousPoints[index].y =
    previousPoints[index].y * SMOOTHING + rawY * (1 - SMOOTHING);

  return previousPoints[index];
}

function markLandmarkMissing(index) {
  missingFramesByLandmark[index] =
    (missingFramesByLandmark[index] || 0) + 1;
}

// ------------------------------------------------------------
// ANTI-CHEAT HELPERS
// ------------------------------------------------------------

function calculateTorsoTilt(shoulder, hip) {
  if (!shoulder || !hip) return null;

  const dx = shoulder.x - hip.x;
  const dy = shoulder.y - hip.y;

  if (Math.hypot(dx, dy) < 1e-6) return null;

  return Math.atan2(Math.abs(dx), Math.abs(dy)) * (180 / Math.PI);
}

function updateStandingBaseline(points, avgKneeAngle, now) {
  const lHip = points[23];
  const rHip = points[24];
  const lAnkle = points[27];
  const rAnkle = points[28];

  const isStanding =
    avgKneeAngle !== null &&
    avgKneeAngle > 160 &&
    lHip && rHip && lAnkle && rAnkle;

  if (!isStanding) {
    standingSince = null;
    baselineLostFrames++;
    if (baselineLostFrames > BASELINE_LOST_FRAMES * 3) {
      standingHipY = null;
      baselineLegLength = null;
    }
    return;
  }

  baselineLostFrames = 0;

  if (standingSince === null) standingSince = now;

  if (now - standingSince >= BASELINE_HOLD_MS) {
    const hipY = (lHip.y + rHip.y) / 2;
    const ankleY = (lAnkle.y + rAnkle.y) / 2;
    const hipX = (lHip.x + rHip.x) / 2;
    const ankleX = (lAnkle.x + rAnkle.x) / 2;

    const legLength = Math.hypot(hipX - ankleX, hipY - ankleY);

    if (legLength > 20) {
      if (standingHipY === null) {
        standingHipY = hipY;
        baselineLegLength = legLength;
      } else {
        standingHipY = standingHipY * 0.9 + hipY * 0.1;
        baselineLegLength = baselineLegLength * 0.9 + legLength * 0.1;
      }
    }
  }
}

function validateSquatPosture(points, avgKneeAngle) {
  if (avgKneeAngle === null) {
    return { valid: false, reason: "no-angle" };
  }

  const lHip = points[23], rHip = points[24];
  const lAnkle = points[27], rAnkle = points[28];
  const lShoulder = points[11], rShoulder = points[12];

  if (!lHip || !rHip || !lAnkle || !rAnkle) {
    return { valid: false, reason: "missing-points" };
  }

  if (!(lAnkle.y > lHip.y + 20 && rAnkle.y > rHip.y + 20)) {
    return { valid: false, reason: "ankle-above-hip" };
  }

  if (standingHipY !== null && baselineLegLength !== null) {
    const hipY = (lHip.y + rHip.y) / 2;
    const hipDrop = hipY - standingHipY;
    const requiredDrop = baselineLegLength * MIN_HIP_DROP_RATIO;

    if (avgKneeAngle < currentExercise.downAngle &&
        hipDrop < requiredDrop) {
      return { valid: false, reason: "hips-too-high" };
    }
  }

  if (lShoulder && rShoulder) {
    const lTilt = calculateTorsoTilt(lShoulder, lHip);
    const rTilt = calculateTorsoTilt(rShoulder, rHip);

    if (lTilt !== null && rTilt !== null) {
      const avgTilt = (lTilt + rTilt) / 2;
      if (avgTilt > MAX_TORSO_TILT_DEG) {
        return { valid: false, reason: "torso-lean" };
      }
    }
  }

  return { valid: true, reason: "ok" };
}

// ------------------------------------------------------------
// EVALUATION
// ------------------------------------------------------------

function evaluateRep({ minAngle, maxAngle, durationMs }) {
  const depthScore = scoreDepth(minAngle);
  const tempoScore = scoreTempo(durationMs);
  const rangeScore = scoreRange(minAngle, maxAngle);

  const overall = (depthScore + tempoScore + rangeScore) / 3;

  return {
    minAngle: round1(minAngle),
    maxAngle: round1(maxAngle),
    durationMs: Math.round(durationMs),
    depthScore: Math.round(depthScore),
    tempoScore: Math.round(tempoScore),
    rangeScore: Math.round(rangeScore),
    overall: Math.round(overall),
    grade: gradeFor(overall),
    cue: cueFor(minAngle, durationMs)
  };
}

function scoreDepth(minAngle) {
  if (minAngle === null) return 0;
  if (minAngle <= 90) return 100;
  if (minAngle >= 120) return 0;
  return 100 - ((minAngle - 90) / 30) * 100;
}

function scoreTempo(durationMs) {
  if (durationMs < 1000) return 30;
  if (durationMs < 1500) return 60;
  if (durationMs <= 4000) return 100;
  if (durationMs <= 6000) return 60;
  return 30;
}

function scoreRange(minAngle, maxAngle) {
  if (minAngle === null || maxAngle === null) return 0;
  const range = maxAngle - minAngle;
  if (range >= 70) return 100;
  if (range <= 20) return 0;
  return ((range - 20) / 50) * 100;
}

function gradeFor(overall) {
  if (overall >= 80) return "good";
  if (overall >= 60) return "fair";
  return "poor";
}

function cueFor(minAngle, durationMs) {
  if (minAngle === null) return "Rep incomplete";
  if (minAngle > 105) return "Go deeper next rep";
  if (durationMs < 1200) return "Slow down — controlled movement";
  return "Good depth";
}

function round1(n) {
  return n === null ? null : Math.round(n * 10) / 10;
}

function snapshotEvaluation(avg, validation) {
  const now = performance.now();

  const minA = repMinAngle ?? avg;
  const maxA = repMaxAngle ?? avg;
  const dur = repStartTime !== null ? now - repStartTime : 0;

  const depthScore = minA !== null ? scoreDepth(minA) : null;
  const tempoScore = dur > 0 ? scoreTempo(dur) : null;
  const rangeScore = (minA !== null && maxA !== null)
    ? scoreRange(minA, maxA)
    : null;

  const valid = depthScore !== null && tempoScore !== null && rangeScore !== null;
  const overall = valid
    ? Math.round((depthScore + tempoScore + rangeScore) / 3)
    : null;

  let status = "idle";
  let reason = "";

  if (!validation || !validation.valid) {
    if (validation) {
      if (validation.reason === "torso-lean") {
        status = "rejected";
        reason = "Torso lean detected";
      } else if (validation.reason === "hips-too-high") {
        status = "rejected";
        reason = "Hips didn't drop enough";
      }
    }
  } else if (squatState === "DOWN") {
    status = "counting";
  } else if (standingHipY === null) {
    status = "calibrating";
  }

  return {
    status,
    reason,
    depth: depthScore !== null ? Math.round(depthScore) : null,
    tempo: tempoScore !== null ? Math.round(tempoScore) : null,
    range: rangeScore !== null ? Math.round(rangeScore) : null,
    overall,
    minAngle: minA,
    maxAngle: maxA,
    durationMs: dur,
    valid: validation ? validation.valid : false
  };
}

function updateEvaluationPanel(snapshot) {
  if (!snapshot) {
    evalStatusEl.textContent = "Idle";
    evalStatusEl.dataset.status = "idle";
    evalDepthEl.textContent = "--";
    evalTempoEl.textContent = "--";
    evalRangeEl.textContent = "--";
    evalOverallEl.textContent = "--";
    evalMinAngleEl.textContent = "--";
    evalMaxAngleEl.textContent = "--";
    evalDurationEl.textContent = "--";
    evalReasonEl.textContent = "";
    return;
  }

  const statusLabels = {
    idle: "Idle",
    counting: "Counting…",
    rejected: "Rejected",
    calibrating: "Calibrating…"
  };

  evalStatusEl.textContent = statusLabels[snapshot.status] || "Idle";
  evalStatusEl.dataset.status = snapshot.status;

  evalDepthEl.textContent = snapshot.depth !== null ? snapshot.depth : "--";
  evalTempoEl.textContent = snapshot.tempo !== null ? snapshot.tempo : "--";
  evalRangeEl.textContent = snapshot.range !== null ? snapshot.range : "--";
  evalOverallEl.textContent = snapshot.overall !== null ? snapshot.overall : "--";

  evalMinAngleEl.textContent =
    snapshot.minAngle !== null ? `${Math.round(snapshot.minAngle)}°` : "--";
  evalMaxAngleEl.textContent =
    snapshot.maxAngle !== null ? `${Math.round(snapshot.maxAngle)}°` : "--";
  evalDurationEl.textContent =
    snapshot.durationMs > 0 ? `${(snapshot.durationMs / 1000).toFixed(1)}s` : "--";

  evalReasonEl.textContent = snapshot.reason || "";
}

function finalizeRepEvaluation(now) {
  const result = evaluateRep({
    minAngle: repMinAngle,
    maxAngle: repMaxAngle,
    durationMs: repStartTime !== null ? now - repStartTime : 0
  });

  // Save per-rep comment
  result.comment = result.cue;

  recordRepResult(result);

  // Show last rep comment in panel
  lastCommentTextEl.textContent = `#${squatCount} · ${result.cue}`;
  lastCommentEl.classList.remove("is-hidden");

  const label =
    result.grade === "good" ? "GOOD" :
    result.grade === "fair" ? "FAIR" : "NEEDS WORK";

  showFlash(
    `Rep ${squatCount}: ${label} · ${result.overall}/100 · ${result.cue}`,
    result.grade
  );

  lastEvaluation = result;
  lastEvaluationAt = now;

  updateProgress();
}

// ------------------------------------------------------------
// CANVAS DRAWING
// ------------------------------------------------------------

function drawLowerBody(landmarks, cw, ch, vw, vh, sx, sy, srcW, srcH) {
  if (!landmarks || landmarks.length < 33) return null;

  function getPoint(index) {
    const landmark = landmarks[index];
    if (!isLandmarkVisible(landmark)) {
      markLandmarkMissing(index);
      return null;
    }

    const videoX = landmark.x * vw;
    const videoY = landmark.y * vh;

    const u = (videoX - sx) / srcW;
    const v = (videoY - sy) / srcH;

    if (u < 0 || u > 1 || v < 0 || v > 1) {
      markLandmarkMissing(index);
      return null;
    }

    const rawX = (1 - u) * cw;
    const rawY = v * ch;

    return smoothPoint(index, rawX, rawY);
  }

  const points = {};
  for (const index of LOWER_BODY_INDICES) {
    points[index] = getPoint(index);
  }

  ctx.strokeStyle = "#00ff88";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";

  for (const [i, j] of LOWER_BODY_CONNECTIONS) {
    const p1 = points[i];
    const p2 = points[j];
    if (!p1 || !p2) continue;

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  for (const index of DRAWN_JOINT_INDICES) {
    const point = points[index];
    if (!point) continue;

    ctx.beginPath();
    ctx.arc(point.x, point.y, 6, 0, 2 * Math.PI);
    ctx.fillStyle = "#ff3366";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const measurement = currentExercise.measure(points);

  if (!measurement) {
    leftKneeAngle = null;
    rightKneeAngle = null;

    poseLostFrames++;
    if (poseLostFrames >= POSE_LOST_RESET_FRAMES) {
      squatState = "UP";
      resetRepState();
    }

    setMpStatus("Pose detected; knee landmarks unavailable.");
    return null;
  }

  poseLostFrames = 0;

  leftKneeAngle = measurement.left;
  rightKneeAngle = measurement.right;

  const now = performance.now();

  updateStandingBaseline(points, measurement.avg, now);

  const validation = validateSquatPosture(points, measurement.avg);

  if (validation.valid) {
    updateSquatCounter(measurement.avg);
  } else {
    if (squatState === "DOWN") squatState = "UP";
    resetRepState();
  }

  ctx.font = "bold 18px Arial";
  ctx.fillStyle = "#ffff00";
  ctx.shadowColor = "#000";
  ctx.shadowBlur = 4;

  if (points[25]) {
    ctx.fillText(`${Math.round(leftKneeAngle)}°`, points[25].x + 12, points[25].y);
  }
  if (points[26]) {
    ctx.fillText(`${Math.round(rightKneeAngle)}°`, points[26].x + 12, points[26].y);
  }

  ctx.shadowBlur = 0;

  return {
    points,
    measurement,
    validation,
    avg: measurement.avg
  };
}

// ------------------------------------------------------------
// REP DETECTION
// ------------------------------------------------------------

function updateSquatCounter(avgKneeAngle) {
  const now = performance.now();

  if (squatState === "UP") {
    upSince = null;

    if (avgKneeAngle < currentExercise.downAngle) {
      if (downSince === null) downSince = now;

      if (now - downSince >= DOWN_HOLD_MS) {
        squatState = "DOWN";
        downSince = null;
        repStartTime = now;
        repMinAngle = avgKneeAngle;
        repMaxAngle = avgKneeAngle;
      }
    } else {
      downSince = null;
    }
  } else {
    downSince = null;

    if (repMinAngle === null || avgKneeAngle < repMinAngle) {
      repMinAngle = avgKneeAngle;
    }
    if (repMaxAngle === null || avgKneeAngle > repMaxAngle) {
      repMaxAngle = avgKneeAngle;
    }

    if (repStartTime !== null && now - repStartTime > MAX_REP_DURATION_MS) {
      squatState = "UP";
      resetRepState();
      return;
    }

    if (avgKneeAngle > currentExercise.upAngle) {
      if (upSince === null) upSince = now;

      if (now - upSince >= UP_HOLD_MS) {
        squatState = "UP";
        squatCount++;
        upSince = null;
        finalizeRepEvaluation(now);
        resetRepState();
      }
    } else {
      upSince = null;
    }
  }
}

// ------------------------------------------------------------
// SESSION RECORDING
// ------------------------------------------------------------

function recordFrame(avg, left, right, state) {
  if (sessionStartTime === null) sessionStartTime = performance.now();

  sessionLog.push({
    type: "frame",
    t: ((performance.now() - sessionStartTime) / 1000).toFixed(3),
    avg: avg === null ? "" : avg.toFixed(2),
    left: left === null ? "" : left.toFixed(2),
    right: right === null ? "" : right.toFixed(2),
    state
  });
}

function recordRepResult(result) {
  if (sessionStartTime === null) sessionStartTime = performance.now();

  sessionLog.push({
    type: "rep",
    t: ((performance.now() - sessionStartTime) / 1000).toFixed(3),
    rep: squatCount,
    minAngle: result.minAngle,
    maxAngle: result.maxAngle,
    durationMs: result.durationMs,
    depthScore: result.depthScore,
    tempoScore: result.tempoScore,
    rangeScore: result.rangeScore,
    overall: result.overall,
    grade: result.grade,
    comment: result.comment || ""
  });

  console.log(`[REP ${squatCount}]`, result);
}

function exportSessionCSV() {
  if (sessionLog.length === 0) {
    setStatus("Nothing to export yet.", true);
    return;
  }

  const lines = [
    "type,time_s,rep,avg_angle,left_angle,right_angle,state,min_angle,max_angle,duration_ms,depth_score,tempo_score,range_score,overall,grade,comment"
  ];

  for (const r of sessionLog) {
    if (r.type === "frame") {
      lines.push(
        `frame,${r.t},,,${r.avg},${r.left},${r.right},${r.state},,,,,,,,`
      );
    } else {
      lines.push(
        `rep,${r.t},${r.rep},,,,,,${r.minAngle},${r.maxAngle},${r.durationMs},${r.depthScore},${r.tempoScore},${r.rangeScore},${r.overall},${r.grade},"${escapeCsv(r.comment)}"`
      );
    }
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `rehab_session_${Date.now()}.csv`;
  a.click();

  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------
// VIDEO LOOP
// ------------------------------------------------------------

function drawFrame() {
  if (!stream || !sourceVideo.srcObject) {
    rafId = null;
    return;
  }

  const vw = sourceVideo.videoWidth;
  const vh = sourceVideo.videoHeight;
  const cw = stageCanvas.width;
  const ch = stageCanvas.height;

  if (vw > 0 && vh > 0) {
    const scale = Math.max(cw / vw, ch / vh);
    const srcW = cw / scale;
    const srcH = ch / scale;
    const sx = (vw - srcW) / 2;
    const sy = (vh - srcH) / 2;

    ctx.save();
    ctx.translate(cw, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(sourceVideo, sx, sy, srcW, srcH, 0, 0, cw, ch);
    ctx.restore();

    if (poseLandmarker && sourceVideo.currentTime !== lastVideoTime) {
      lastVideoTime = sourceVideo.currentTime;

      try {
        const results = poseLandmarker.detectForVideo(
          sourceVideo, performance.now()
        );

        latestLandmarks = results.landmarks?.[0] ?? null;

        if (latestLandmarks) {
          setMpStatus("Pose detected.");
        } else {
          setMpStatus("No pose detected.");
          leftKneeAngle = null;
          rightKneeAngle = null;
          poseLostFrames++;
          if (poseLostFrames >= POSE_LOST_RESET_FRAMES) {
            squatState = "UP";
            resetRepState();
          }
        }
      } catch (error) {
        console.error("Pose detection failed:", error);
        latestLandmarks = null;
        leftKneeAngle = null;
        rightKneeAngle = null;
        setMpStatus("Pose detection error.", true);
      }
    }

    let frameState = null;

    if (latestLandmarks) {
      frameState = drawLowerBody(latestLandmarks, cw, ch, vw, vh, sx, sy, srcW, srcH);

      if (frameState) {
        recordFrame(
          frameState.avg,
          frameState.measurement.left,
          frameState.measurement.right,
          squatState
        );
      }
    }

    const snapshot = snapshotEvaluation(
      frameState ? frameState.avg : null,
      frameState ? frameState.validation : null
    );
    updateEvaluationPanel(snapshot);

    updatePanel();
    updateFlashVisibility(performance.now());
  }

  rafId = requestAnimationFrame(drawFrame);
}

// ------------------------------------------------------------
// CAMERA CONTROLS
// ------------------------------------------------------------

async function openCamera() {
  if (cameraStarting || stream) return;

  cameraStarting = true;
  setCameraUi(false);

  const session = ++cameraSession;

  setStatus("Loading pose model...");
  setMpStatus("Initializing...");

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access is unavailable. Use localhost or HTTPS.");
    }

    await initPoseLandmarker();
    if (session !== cameraSession) return;

    modelReady = true;
    setStatus("Requesting camera access...");

    const newStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    if (session !== cameraSession) {
      newStream.getTracks().forEach(t => t.stop());
      return;
    }

    stream = newStream;
    sourceVideo.srcObject = stream;

    await new Promise((resolve, reject) => {
      if (sourceVideo.videoWidth > 0) { resolve(); return; }
      sourceVideo.onloadedmetadata = resolve;
      sourceVideo.onerror = () => reject(new Error("Could not load the camera video."));
    });

    if (session !== cameraSession) return;

    await sourceVideo.play();
    if (session !== cameraSession) return;

    resetTrackingState();

    setCameraUi(true);
    setStatus("Camera is live.");
    setMpStatus("Searching for pose...");

    drawFrame();
  } catch (error) {
    console.error("Camera initialization failed:", error);

    if (session === cameraSession) {
      let message = error.message || "Could not start the camera.";

      if (error.name === "NotAllowedError") message = "Camera permission denied.";
      else if (error.name === "NotFoundError") message = "No camera device found.";
      else if (error.name === "NotReadableError") message = "Camera is in use by another application.";

      setStatus(message, true);
      closeCamera({ silent: true });
    }
  } finally {
    cameraStarting = false;
    setCameraUi(Boolean(stream));
  }
}

function closeCamera({ silent = false } = {}) {
  cameraSession++;

  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  sourceVideo.onloadedmetadata = null;
  sourceVideo.onerror = null;
  sourceVideo.srcObject = null;

  ctx.clearRect(0, 0, stageCanvas.width, stageCanvas.height);

  resetTrackingState();
  updatePanel();
  updateProgress();

  setCameraUi(false);
  setMpStatus("Waiting.");

  if (!silent) setStatus("Camera is off.");
}

// ------------------------------------------------------------
// EVENTS
// ------------------------------------------------------------

openBtn.addEventListener("click", openCamera);
closeBtn.addEventListener("click", () => closeCamera());
exportBtn.addEventListener("click", exportSessionCSV);

targetRepsEl.addEventListener("change", () => {
  targetReps = parseInt(targetRepsEl.value, 10) || 10;
  sessionCompleteShown = false;
  updateProgress();
});

window.addEventListener("pagehide", () => {
  closeCamera({ silent: true });
  if (poseLandmarker) {
    poseLandmarker.close();
    poseLandmarker = null;
    modelReady = false;
  }
});

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------

setCameraUi(false);
updatePanel();
updateProgress();
updateEvaluationPanel(null);