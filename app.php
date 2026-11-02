<?php
require 'auth_helper.php';
require_login();   // kicks unauthenticated users back to login.php

$username = $_SESSION['user'] ?? 'guest';
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Exercise Session — Knee Rehab Monitoring</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body class="app-body">

  <!-- ============ HEADER (shared pattern) ============ -->
  <header class="site-header">
    <div class="site-header__inner">
      <a href="landingpage.html" class="site-header__brand">
        <span class="site-header__mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="28" height="28">
            <circle cx="16" cy="16" r="15" fill="#00703C" />
            <path d="M10 20 C 12 12, 20 12, 22 20" stroke="#F2A900" stroke-width="2.5"
                  fill="none" stroke-linecap="round" />
            <circle cx="10" cy="20" r="2" fill="#fff" />
            <circle cx="22" cy="20" r="2" fill="#fff" />
          </svg>
        </span>
        <span class="site-header__name">Knee Rehab Monitoring</span>
      </a>
      <div class="site-header__user">
        <span class="site-header__user-label">Signed in as</span>
        <span class="site-header__user-name" id="currentUser"><?= e($username) ?></span>
        <a href="logout.php" class="btn btn--secondary btn--sm">Log out</a>
      </div>
    </div>
  </header>

  <!-- ============ APP SHELL ============ -->
  <main class="app">
    <div class="app__heading">
      <h1 class="app__title">Exercise Session</h1>
      <p class="app__subtitle">Position your full lower body in view, then start the camera.</p>
    </div>

    <!-- Hidden video: holds the raw MediaStream. Never shown. -->
    <video id="sourceVideo" playsinline muted></video>

    <!-- Two-column layout: stage on the left, feedback panel on the right -->
    <div class="session">

      <!-- Left: camera stage -->
      <div class="session__stage">
        <div class="stage">
          <canvas id="stageCanvas" width="640" height="480"></canvas>
          <div id="stageMessage" class="stage__message">Camera is off</div>
        </div>

        <div class="controls">
          <button id="openBtn" type="button" class="btn btn--primary">Open Camera</button>
          <button id="closeBtn" type="button" class="btn btn--secondary" disabled>Close Camera</button>
        </div>

        <p id="status" class="status" role="status" aria-live="polite"></p>
        <p id="mpStatus" class="mp-status" role="status" aria-live="polite"></p>
      </div>

      <!-- Right: feedback panel -->
      <aside class="session__panel" aria-label="Exercise feedback">

        <!-- Rep count -->
        <div class="panel-card panel-card--count">
          <span class="panel-card__label">Squats</span>
          <span id="repCount" class="panel-card__number">0</span>
        </div>

        <!-- Target + progress -->
        <div class="panel-card panel-card--target">
          <div class="target-row">
            <label for="targetReps" class="panel-card__label">Target reps</label>
            <select id="targetReps" class="target-select">
              <option value="6">6</option>
              <option value="8">8</option>
              <option value="10" selected>10</option>
              <option value="12">12</option>
              <option value="15">15</option>
              <option value="20">20</option>
            </select>
          </div>
          <div class="progress">
            <div id="progressBar" class="progress__bar"></div>
          </div>
          <div class="progress-text">
            <span id="progressText">0 / 10</span>
            <span id="progressStatus" class="progress-status">In progress</span>
          </div>
        </div>

        <!-- Live stats -->
        <div class="panel-card">
          <div class="panel-row">
            <span class="panel-row__label">State</span>
            <span id="repState" class="panel-row__value">UP</span>
          </div>
          <div class="panel-row">
            <span class="panel-row__label">Knee angle</span>
            <span id="angleValue" class="panel-row__value">--</span>
          </div>
          <div class="panel-row">
            <span class="panel-row__label">L / R</span>
            <span id="lrAngles" class="panel-row__value">-- / --</span>
          </div>
        </div>

        <!-- Live feedback line -->
        <div id="feedback" class="feedback">Ready</div>

        <!-- Rep-complete flash -->
        <div id="flash" class="flash is-hidden">
          <span id="flashText">Rep complete</span>
        </div>

        <!-- Last rep comment -->
        <div id="lastComment" class="last-comment is-hidden">
          <span class="last-comment__label">Last rep</span>
          <span id="lastCommentText" class="last-comment__text"></span>
        </div>

        <!-- Session complete banner -->
        <div id="sessionComplete" class="session-complete is-hidden">
          🎉 <strong>Session complete</strong> — you hit your target!
        </div>

        <!-- Rep evaluation card -->
        <div id="evalCard" class="eval-card">
          <div class="eval-card__header">
            <span class="eval-card__title">Rep Evaluation</span>
            <span id="evalStatus" class="eval-card__status" data-status="idle">Idle</span>
          </div>
          <div class="eval-card__grid">
            <div class="eval-row">
              <span class="eval-row__label">Depth</span>
              <span id="evalDepth" class="eval-row__value">--</span>
            </div>
            <div class="eval-row">
              <span class="eval-row__label">Tempo</span>
              <span id="evalTempo" class="eval-row__value">--</span>
            </div>
            <div class="eval-row">
              <span class="eval-row__label">Range</span>
              <span id="evalRange" class="eval-row__value">--</span>
            </div>
            <div class="eval-row eval-row--overall">
              <span class="eval-row__label">Overall</span>
              <span id="evalOverall" class="eval-row__value">--</span>
            </div>
          </div>
          <div class="eval-card__angles">
            <span>Min: <span id="evalMinAngle">--</span></span>
            <span>Max: <span id="evalMaxAngle">--</span></span>
            <span>Dur: <span id="evalDuration">--</span></span>
          </div>
          <div id="evalReason" class="eval-card__reason"></div>
        </div>

        <!-- Export -->
        <button id="exportBtn" type="button" class="btn btn--secondary btn--block">
          Export Session CSV
        </button>
      </aside>

    </div>
  </main>

  <script type="module" src="script.js"></script>
</body>
</html>