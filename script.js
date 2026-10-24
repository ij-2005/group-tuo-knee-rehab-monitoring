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

    const SQUAT_DOWN_ANGLE = 120;
    const STAND_UP_ANGLE = 165;

    // Exponential smoothing: higher = smoother but slower.
    const SMOOTHING = 0.7;

    // Minimum landmark visibility for angle calculations.
    const MIN_VISIBILITY = 0.5;

    // ------------------------------------------------------------
    // DOM ELEMENTS
    // ------------------------------------------------------------

    const sourceVideo = document.getElementById("sourceVideo");
    const stageCanvas = document.getElementById("stageCanvas");
    const stageMessage = document.getElementById("stageMessage");

    const openBtn = document.getElementById("openBtn");
    const closeBtn = document.getElementById("closeBtn");

    const statusEl = document.getElementById("status");
    const mpStatusEl = document.getElementById("mpStatus");

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

    let squatCount = 0;
    let squatState = "UP";

    let leftKneeAngle = null;
    let rightKneeAngle = null;

    let downFrames = 0;
    let upFrames = 0;

    // Require several consecutive valid frames before changing state.
    const REQUIRED_FRAMES = 3;

    // BlazePose landmark indices.
    const LOWER_BODY_INDICES = [
      23, 24, 25, 26, 27, 28, 29, 30, 31, 32
    ];

    const LOWER_BODY_CONNECTIONS = [
      [23, 25],
      [25, 27],
      [24, 26],
      [26, 28],
      [23, 24],
      [25, 26],
      [27, 28],
      [27, 29],
      [28, 30],
      [29, 31],
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

    // ------------------------------------------------------------
    // MEDIAPIPE INITIALIZATION
    // ------------------------------------------------------------

    async function initPoseLandmarker() {
      if (poseLandmarker) {
        return poseLandmarker;
      }

      const vision = await FilesetResolver.forVisionTasks(
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
      );

      poseLandmarker = await PoseLandmarker.createFromOptions(
        vision,
        {
          baseOptions: {
            modelAssetPath: MODEL_URL,

            // CPU is a compatible starting point across more devices.
            delegate: "CPU"
          },

          runningMode: "VIDEO",
          numPoses: 1,

          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.7
        }
      );

      return poseLandmarker;
    }

    // ------------------------------------------------------------
    // GEOMETRY HELPERS
    // ------------------------------------------------------------

    function calculateAngle(a, b, c) {
      // Calculate angle ABC, with B as the vertex.
      const abx = a.x - b.x;
      const aby = a.y - b.y;

      const cbx = c.x - b.x;
      const cby = c.y - b.y;

      const dot = abx * cbx + aby * cby;

      const magAB = Math.hypot(abx, aby);
      const magCB = Math.hypot(cbx, cby);

      if (magAB < 1e-6 || magCB < 1e-6) {
        return null;
      }

      let cosine = dot / (magAB * magCB);

      // Prevent floating-point errors outside [-1, 1].
      cosine = Math.max(-1, Math.min(1, cosine));

      return Math.acos(cosine) * (180 / Math.PI);
    }

    function isLandmarkVisible(landmark) {
      return Boolean(
        landmark &&
        Number.isFinite(landmark.x) &&
        Number.isFinite(landmark.y) &&
        (
          landmark.visibility === undefined ||
          landmark.visibility >= MIN_VISIBILITY
        )
      );
    }

    function smoothPoint(index, rawX, rawY) {
      if (!previousPoints[index]) {
        previousPoints[index] = {
          x: rawX,
          y: rawY
        };

        return previousPoints[index];
      }

      previousPoints[index].x =
        previousPoints[index].x * SMOOTHING +
        rawX * (1 - SMOOTHING);

      previousPoints[index].y =
        previousPoints[index].y * SMOOTHING +
        rawY * (1 - SMOOTHING);

      return previousPoints[index];
    }

    // ------------------------------------------------------------
    // LOWER-BODY DRAWING AND ANALYSIS
    // ------------------------------------------------------------

    function drawLowerBody(
      landmarks,
      cw,
      ch,
      vw,
      vh,
      sx,
      sy,
      srcW,
      srcH
    ) {
      if (!landmarks || landmarks.length < 33) {
        return;
      }

      // Convert normalized landmarks to the mirrored, cropped canvas.
      function getPoint(index) {
        const landmark = landmarks[index];

        if (!isLandmarkVisible(landmark)) {
          return null;
        }

        const videoX = landmark.x * vw;
        const videoY = landmark.y * vh;

        const u = (videoX - sx) / srcW;
        const v = (videoY - sy) / srcH;

        // Ignore landmarks outside the visible crop.
        if (u < 0 || u > 1 || v < 0 || v > 1) {
          return null;
        }

        const rawX = (1 - u) * cw;
        const rawY = v * ch;

        return smoothPoint(index, rawX, rawY);
      }

      // Collect points once so drawing and angle calculations
      // use exactly the same coordinates.
      const points = {};

      for (const index of LOWER_BODY_INDICES) {
        points[index] = getPoint(index);
      }

      // Draw skeleton connections.
      ctx.strokeStyle = "#00ff88";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";

      for (const [i, j] of LOWER_BODY_CONNECTIONS) {
        const p1 = points[i];
        const p2 = points[j];

        if (!p1 || !p2) {
          continue;
        }

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }

      // Draw joints.
      for (const index of LOWER_BODY_INDICES) {
        const point = points[index];

        if (!point) {
          continue;
        }

        ctx.beginPath();
        ctx.arc(point.x, point.y, 6, 0, 2 * Math.PI);

        ctx.fillStyle = "#ff3366";
        ctx.fill();

        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      const leftHip = points[23];
      const rightHip = points[24];

      const leftKnee = points[25];
      const rightKnee = points[26];

      const leftAnkle = points[27];
      const rightAnkle = points[28];

      const allKneePointsValid = Boolean(
        leftHip &&
        leftKnee &&
        leftAnkle &&
        rightHip &&
        rightKnee &&
        rightAnkle
      );

      if (!allKneePointsValid) {
        leftKneeAngle = null;
        rightKneeAngle = null;

        downFrames = 0;
        upFrames = 0;

        setMpStatus("Pose detected; knee landmarks unavailable.");

        drawOverlay(null);
        return;
      }

      leftKneeAngle = calculateAngle(
        leftHip,
        leftKnee,
        leftAnkle
      );

      rightKneeAngle = calculateAngle(
        rightHip,
        rightKnee,
        rightAnkle
      );

      if (
        leftKneeAngle === null ||
        rightKneeAngle === null
      ) {
        drawOverlay(null);
        return;
      }

      const avgKneeAngle =
        (leftKneeAngle + rightKneeAngle) / 2;

      updateSquatCounter(avgKneeAngle);

      // Draw angle labels.
      ctx.font = "bold 20px Arial";
      ctx.fillStyle = "#ffff00";

      ctx.fillText(
        `${Math.round(leftKneeAngle)}°`,
        leftKnee.x + 12,
        leftKnee.y
      );

      ctx.fillText(
        `${Math.round(rightKneeAngle)}°`,
        rightKnee.x + 12,
        rightKnee.y
      );

      drawOverlay(avgKneeAngle);
    }

    // ------------------------------------------------------------
    // SQUAT DETECTION
    // ------------------------------------------------------------

    function updateSquatCounter(avgKneeAngle) {
      if (squatState === "UP") {
        upFrames = 0;

        if (avgKneeAngle < SQUAT_DOWN_ANGLE) {
          downFrames++;
        } else {
          downFrames = 0;
        }

        if (downFrames >= REQUIRED_FRAMES) {
          squatState = "DOWN";
          downFrames = 0;
        }
      } else {
        downFrames = 0;

        if (avgKneeAngle > STAND_UP_ANGLE) {
          upFrames++;
        } else {
          upFrames = 0;
        }

        if (upFrames >= REQUIRED_FRAMES) {
          squatState = "UP";
          squatCount++;

          upFrames = 0;
        }
      }
    }

    // ------------------------------------------------------------
    // STATUS OVERLAY
    // ------------------------------------------------------------

    function drawOverlay(avgKneeAngle) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
      ctx.fillRect(10, 10, 280, 145);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 22px Arial";

      ctx.fillText(`Squats: ${squatCount}`, 22, 42);
      ctx.fillText(`State: ${squatState}`, 22, 75);

      const angleText =
        avgKneeAngle === null
          ? "Angle: --"
          : `Angle: ${Math.round(avgKneeAngle)}°`;

      ctx.fillText(angleText, 22, 108);

      ctx.font = "14px Arial";
      ctx.fillStyle = "#00ff88";

      ctx.fillText(
        `L: ${leftKneeAngle === null ? "--" : Math.round(leftKneeAngle) + "°"}   ` +
        `R: ${rightKneeAngle === null ? "--" : Math.round(rightKneeAngle) + "°"}`,
        22,
        135
      );
    }

    // ------------------------------------------------------------
    // VIDEO FRAME LOOP
    // ------------------------------------------------------------

    function drawFrame() {
      // A stopped or replaced camera session must not keep looping.
      if (!stream || !sourceVideo.srcObject) {
        rafId = null;
        return;
      }

      const vw = sourceVideo.videoWidth;
      const vh = sourceVideo.videoHeight;

      const cw = stageCanvas.width;
      const ch = stageCanvas.height;

      if (vw > 0 && vh > 0) {
        // Center-crop the source to match the canvas aspect ratio.
        const scale = Math.max(cw / vw, ch / vh);

        const srcW = cw / scale;
        const srcH = ch / scale;

        const sx = (vw - srcW) / 2;
        const sy = (vh - srcH) / 2;

        // Draw mirrored webcam video.
        ctx.save();
        ctx.translate(cw, 0);
        ctx.scale(-1, 1);

        ctx.drawImage(
          sourceVideo,
          sx, sy, srcW, srcH,
          0, 0, cw, ch
        );

        ctx.restore();

        // Detect only once per new video frame, but redraw the
        // latest landmarks every animation frame.
        if (
          poseLandmarker &&
          sourceVideo.currentTime !== lastVideoTime
        ) {
          lastVideoTime = sourceVideo.currentTime;

          try {
            const results = poseLandmarker.detectForVideo(
              sourceVideo,
              performance.now()
            );

            latestLandmarks =
              results.landmarks?.[0] ?? null;

            if (latestLandmarks) {
              setMpStatus("Pose detected.");
            } else {
              setMpStatus("No pose detected.");

              leftKneeAngle = null;
              rightKneeAngle = null;

              downFrames = 0;
              upFrames = 0;
            }
          } catch (error) {
            console.error("Pose detection failed:", error);

            latestLandmarks = null;

            leftKneeAngle = null;
            rightKneeAngle = null;

            setMpStatus("Pose detection error.", true);
          }
        }

        // Draw the most recent pose even when the camera frame
        // has not advanced since the previous animation frame.
        if (latestLandmarks) {
          drawLowerBody(
            latestLandmarks,
            cw,
            ch,
            vw,
            vh,
            sx,
            sy,
            srcW,
            srcH
          );
        } else {
          drawOverlay(null);
        }
      }

      rafId = requestAnimationFrame(drawFrame);
    }

    // ------------------------------------------------------------
    // CAMERA CONTROLS
    // ------------------------------------------------------------

    async function openCamera() {
      if (cameraStarting || stream) {
        return;
      }

      cameraStarting = true;
      setCameraUi(false);

      const session = ++cameraSession;

      setStatus("Loading pose model...");
      setMpStatus("Initializing...");

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "Camera access is unavailable. Use localhost or HTTPS."
          );
        }

        await initPoseLandmarker();

        // Do not open a camera if the user stopped the operation
        // while the model was loading.
        if (session !== cameraSession) {
          return;
        }

        modelReady = true;

        setStatus("Requesting camera access...");

        const newStream =
          await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: "user",
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: false
          });

        if (session !== cameraSession) {
          newStream.getTracks().forEach(track => track.stop());
          return;
        }

        stream = newStream;
        sourceVideo.srcObject = stream;

        await new Promise((resolve, reject) => {
          if (sourceVideo.videoWidth > 0) {
            resolve();
            return;
          }

          sourceVideo.onloadedmetadata = resolve;

          sourceVideo.onerror = () => {
            reject(new Error("Could not load the camera video."));
          };
        });

        if (session !== cameraSession) {
          return;
        }

        await sourceVideo.play();

        if (session !== cameraSession) {
          return;
        }

        lastVideoTime = -1;
        latestLandmarks = null;
        previousPoints = {};

        setCameraUi(true);
        setStatus("Camera is live.");
        setMpStatus("Searching for pose...");

        drawFrame();

      } catch (error) {
        console.error("Camera initialization failed:", error);

        if (session === cameraSession) {
          let message = error.message || "Could not start the camera.";

          if (error.name === "NotAllowedError") {
            message = "Camera permission denied.";
          } else if (error.name === "NotFoundError") {
            message = "No camera device found.";
          } else if (error.name === "NotReadableError") {
            message = "Camera is in use by another application.";
          }

          setStatus(message, true);
          closeCamera({ silent: true });
        }

      } finally {
        cameraStarting = false;

        if (stream) {
          setCameraUi(true);
        } else {
          setCameraUi(false);
        }
      }
    }

    function closeCamera({ silent = false } = {}) {
      // Invalidate any camera startup still in progress.
      cameraSession++;

      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
      }

      sourceVideo.onloadedmetadata = null;
      sourceVideo.onerror = null;
      sourceVideo.srcObject = null;

      ctx.clearRect(
        0,
        0,
        stageCanvas.width,
        stageCanvas.height
      );

      previousPoints = {};
      latestLandmarks = null;
      lastVideoTime = -1;

      leftKneeAngle = null;
      rightKneeAngle = null;

      downFrames = 0;
      upFrames = 0;

      // Keep the count and model so the session can resume.
      setCameraUi(false);
      setMpStatus("Waiting.");

      if (!silent) {
        setStatus("Camera is off.");
      }
    }

    // ------------------------------------------------------------
    // EVENT LISTENERS
    // ------------------------------------------------------------

    openBtn.addEventListener("click", openCamera);

    closeBtn.addEventListener("click", () => {
      closeCamera();
    });

    window.addEventListener("pagehide", () => {
      closeCamera({ silent: true });

      if (poseLandmarker) {
        poseLandmarker.close();
        poseLandmarker = null;
        modelReady = false;
      }
    });

    // Initial interface state.
    setCameraUi(false);
