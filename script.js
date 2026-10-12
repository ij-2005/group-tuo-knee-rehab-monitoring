// ---------------------------------------------------------------------------
// Knee Rehab Monitoring System — v1 Prototype
// Scope: webcam open/close, square center-cropped canvas display.
// No MediaPipe, no angle math, no feedback yet. Those are v2+.
// ---------------------------------------------------------------------------

const sourceVideo = document.getElementById('sourceVideo');
const stageCanvas = document.getElementById('stageCanvas');
const stageMessage = document.getElementById('stageMessage');
const openBtn = document.getElementById('openBtn');
const closeBtn = document.getElementById('closeBtn');
const statusEl = document.getElementById('status');

const ctx = stageCanvas.getContext('2d');

let stream = null;        // active MediaStream
let rafId = null;         // requestAnimationFrame handle

// --- UI helpers ------------------------------------------------------------

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('is-error', isError);
}

function setCameraUi(isOn) {
  openBtn.disabled = isOn;
  closeBtn.disabled = !isOn;
  stageMessage.classList.toggle('is-hidden', isOn);
}

// --- Frame rendering -------------------------------------------------------

/**
 * Draw the current video frame onto the square canvas using center-crop.
 *
 * Math: we scale the video so that its SMALLER dimension fills the canvas,
 * then crop the overflow on the larger dimension. The result is a square
 * that is fully covered by the video with no distortion and no letterbox.
 */
function drawFrame() {
  const vw = sourceVideo.videoWidth;
  const vh = sourceVideo.videoHeight;
  const cw = stageCanvas.width;
  const ch = stageCanvas.height;

  if (vw && vh) {
    const scale = Math.max(cw / vw, ch / vh);
    const drawW = vw * scale;
    const drawH = vh * scale;
    const dx = (cw - drawW) / 2;
    const dy = (ch - drawH) / 2;

    ctx.drawImage(sourceVideo, dx, dy, drawW, drawH);
  }

  rafId = requestAnimationFrame(drawFrame);
}

// --- Camera lifecycle ------------------------------------------------------

async function openCamera() {
  setStatus('Requesting camera access…');

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('getUserMedia is not supported in this browser.', true);
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });

    sourceVideo.srcObject = stream;

    // Wait until metadata is loaded so videoWidth/videoHeight are known.
    await new Promise((resolve) => {
      sourceVideo.onloadedmetadata = () => resolve();
    });

    await sourceVideo.play();

    setCameraUi(true);
    setStatus('Camera is live.');
    drawFrame();
  } catch (err) {
    // Common cases: NotAllowedError (denied), NotFoundError (no camera),
    // NotReadableError (camera in use by another app).
    let msg = 'Could not access the camera.';
    if (err.name === 'NotAllowedError') msg = 'Camera permission denied.';
    else if (err.name === 'NotFoundError') msg = 'No camera device found.';
    else if (err.name === 'NotReadableError') msg = 'Camera is in use by another application.';
    setStatus(msg, true);

    // Clean up anything that may have been partially set up.
    closeCamera({ silent: true });
  }
}

function closeCamera({ silent = false } = {}) {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (stream) {
    // Explicitly stop every track. This releases the camera hardware and
    // turns off the recording indicator — important for privacy.
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  sourceVideo.srcObject = null;

  // Clear the canvas so no last frame lingers.
  ctx.clearRect(0, 0, stageCanvas.width, stageCanvas.height);

  setCameraUi(false);
  if (!silent) setStatus('Camera is off.');
}

// --- Wire up buttons -------------------------------------------------------

openBtn.addEventListener('click', openCamera);
closeBtn.addEventListener('click', () => closeCamera());

// Safety net: stop the camera if the tab is closed or navigated away.
window.addEventListener('pagehide', () => closeCamera({ silent: true }));

// Initial UI state.
setCameraUi(false);