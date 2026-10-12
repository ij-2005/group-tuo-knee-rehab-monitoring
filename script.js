// ---------------------------------------------------------------------------
// Knee Rehab Monitoring System — v2 Prototype
// Webcam + MediaPipe PoseLandmarker (lower-body landmarks only)
// ---------------------------------------------------------------------------

import { FilesetResolver, PoseLandmarker } from
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/vision_bundle.mjs";

// --- MediaPipe version (keep in sync with the import above) ---------------
const MP_VERSION = "0.10.12";

// --- DOM handles -----------------------------------------------------------

const sourceVideo = document.getElementById("sourceVideo");
const stageCanvas = document.getElementById("stageCanvas");
const stageMessage = document.getElementById("stageMessage");
const openBtn = document.getElementById("openBtn");
const closeBtn = document.getElementById("closeBtn");
const statusEl = document.getElementById("status");
const mpStatusEl = document.getElementById("mpStatus");

const ctx = stageCanvas.getContext("2d");

// --- State -----------------------------------------------------------------

let stream = null;            // active MediaStream
let rafId = null;             // requestAnimationFrame handle
let poseLandmarker = null;    // MediaPipe PoseLandmarker instance
let lastVideoTime = -1;       // last processed video timestamp
let modelReady = false;       // true once the model has loaded once

// --- Lower-body landmark definitions --------------------------------------
// BlazePose indices: 23=L hip, 24=R hip, 25=L knee, 26=R knee,
// 27=L ankle, 28=R ankle, 29=L heel, 30=R heel, 31=L foot, 32=R foot.

const LOWER_BODY_INDICES = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

const LOWER_BODY_CONNECTIONS = [
  [23, 25], [25, 27], [27, 29], [29, 31],   // left leg
  [24, 26], [26, 28], [28, 30], [30, 32],   // right leg
  [23, 24],                                 // hip line
  [25, 26],                                 // knee line
  [27, 28],                                 // ankle line
  [29, 30],                                 // heel line
  [31, 32],                                 // foot line
];

// --- UI helpers ------------------------------------------------------------

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

function setMpStatus(message) {
  mpStatusEl.textContent = message;
}

function setCameraUi(isOn) {
  openBtn.disabled = isOn;
  closeBtn.disabled = !isOn;
  stageMessage.classList.toggle("is-hidden", isOn);
}

// --- MediaPipe initialization ---------------------------------------------

async function initPoseLandmarker() {
  if (poseLandmarker) return poseLandmarker;

  const vision = await FilesetResolver.forVisionTasks(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
  );

  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  return poseLandmarker;
}

// --- Landmark drawing ------------------------------------------------------

/**
 * Draw lower-body landmarks on the (already mirrored) canvas.
 *
 * MediaPipe returns normalized coords in [0,1] relative to the *source*
 * video frame. Because we draw the video mirrored, we flip x here too so
 * the skeleton lines up with what the user sees.
 */
function drawLowerBody(landmarks, cw, ch, vw, vh, sx, sy, srcW, srcH) {
  if (!landmarks || landmarks.length === 0) return;

  const lm = landmarks[0];

  // MediaPipe returns normalized [0,1] coords relative to the FULL video
  // frame. Convert to video pixels, then to canvas pixels through the
  // same crop window the video was drawn with.
  const getPoint = (i) => {
    const vx = lm[i].x * vw;   // video pixel x
    const vy = lm[i].y * vh;   // video pixel y

    // Position inside the cropped source rect, normalized to [0,1].
    const u = (vx - sx) / srcW;
    const v = (vy - sy) / srcH;

    // Mirror horizontally to match the flipped canvas, then scale to
    // canvas dimensions.
    return {
      x: (1 - u) * cw,
      y: v * ch,
    };
  };

  // Connections
  ctx.strokeStyle = "#00ff88";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  for (const [i, j] of LOWER_BODY_CONNECTIONS) {
    const p1 = getPoint(i);
    const p2 = getPoint(j);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  // Joints
  for (const i of LOWER_BODY_INDICES) {
    const p = getPoint(i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, 2 * Math.PI);
    ctx.fillStyle = "#ff3366";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// --- Frame loop ------------------------------------------------------------

function drawFrame() {
  const vw = sourceVideo.videoWidth;
  const vh = sourceVideo.videoHeight;
  const cw = stageCanvas.width;
  const ch = stageCanvas.height;

  if (vw && vh) {
    // ---------------------------------------------------------------
    // 1) Draw the raw video mirrored + center-cropped onto the canvas.
    //
    // We mirror by drawing the video flipped horizontally, then crop to
    // a square by only blitting the middle slice of the (scaled) frame.
    // Using source-rectangle crop (sx, sy, sw, sh) avoids signed-offset
    // gymnastics and makes the behavior obvious.
    // ---------------------------------------------------------------

    // Scale factor so the video covers the square (cover, not contain).
    const scale = Math.max(cw / vw, ch / vh);

    // Size of the source rectangle we're going to sample from the video,
    // in video pixel coordinates. It's the largest centered rectangle
    // whose aspect ratio matches the canvas.
    const srcW = cw / scale;
    const srcH = ch / scale;
    const sx = (vw - srcW) / 2;
    const sy = (vh - srcH) / 2;

    // Mirror the canvas horizontally, then draw the cropped source rect
    // filling the entire canvas. Because the canvas is flipped, x=0 in
    // canvas space corresponds to the right edge of the source rect.
    ctx.save();
    ctx.translate(cw, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(
      sourceVideo,
      sx, sy, srcW, srcH,     // source rect (un-mirrored video pixels)
      0, 0, cw, ch            // dest rect (full canvas, then mirrored)
    );
    ctx.restore();

    // ---------------------------------------------------------------
    // 2) Pose detection on the raw video, then draw landmarks mirrored.
    // ---------------------------------------------------------------
    if (poseLandmarker && sourceVideo.currentTime !== lastVideoTime) {
      lastVideoTime = sourceVideo.currentTime;
      const results = poseLandmarker.detectForVideo(
        sourceVideo,
        performance.now()
      );

      if (results.landmarks && results.landmarks.length > 0) {
        drawLowerBody(results.landmarks, cw, ch, vw, vh, sx, sy, srcW, srcH);
        setMpStatus("Pose detected");
      } else {
        setMpStatus("No pose detected");
      }
    }
  }

  rafId = requestAnimationFrame(drawFrame);
}

// --- Camera lifecycle ------------------------------------------------------

async function openCamera() {
  setStatus("Requesting camera access…");
  setMpStatus("");

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("getUserMedia is not supported in this browser.", true);
    return;
  }

  // Load the model once, before opening the camera, so we don't flash
  // "live" without landmarks. Subsequent opens reuse the loaded model.
  if (!modelReady) {
    setStatus("Loading pose model (first time only)…");
    try {
      await initPoseLandmarker();
      modelReady = true;
    } catch (err) {
      console.error(err);
      setStatus("Failed to load pose model. Check the console.", true);
      return;
    }
  }

  setStatus("Requesting camera access…");

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    sourceVideo.srcObject = stream;

    await new Promise((resolve) => {
      sourceVideo.onloadedmetadata = () => resolve();
    });

    await sourceVideo.play();

    setCameraUi(true);
    setStatus("Camera is live.");
    drawFrame();
  } catch (err) {
    let msg = "Could not access the camera.";
    if (err.name === "NotAllowedError") msg = "Camera permission denied.";
    else if (err.name === "NotFoundError") msg = "No camera device found.";
    else if (err.name === "NotReadableError")
      msg = "Camera is in use by another application.";
    setStatus(msg, true);
    closeCamera({ silent: true });
  }
}

function closeCamera({ silent = false } = {}) {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  sourceVideo.srcObject = null;
  ctx.clearRect(0, 0, stageCanvas.width, stageCanvas.height);
  setMpStatus("");
  setCameraUi(false);
  if (!silent) setStatus("Camera is off.");
}

// --- Wire up ---------------------------------------------------------------

openBtn.addEventListener("click", openCamera);
closeBtn.addEventListener("click", () => closeCamera());

window.addEventListener("pagehide", () => closeCamera({ silent: true }));

// Initial UI state
setCameraUi(false);