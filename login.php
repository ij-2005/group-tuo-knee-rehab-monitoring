<?php
require 'auth_helper.php';

$error = '';
$info  = isset($_GET['registered']) ? 'Account created. Please sign in.' : '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';

    $users = load_users();

    if (isset($users[$username]) &&
        password_verify($password, $users[$username]['password_hash'])) {

        // --- Password OK: generate OTP (2FA step 2) ---
        $otp = random_int(100000, 999999);

        $_SESSION['pending_user'] = $username;
        $_SESSION['otp']          = $otp;
        $_SESSION['otp_time']     = time();
        $_SESSION['otp_attempts'] = 0;
        $_SESSION['logged_in']    = false;

        log_event("LOGIN step1 OK: $username (OTP issued)");

        // Demo: display OTP on-screen instead of emailing it.
        $_SESSION['otp_demo_display'] = true;

        header('Location: verify.php');
        exit;
    } else {
        $error = 'Invalid username or password.';
        log_event("LOGIN step1 FAIL: $username");
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sign In — Knee Rehab Monitoring</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body class="login-body">

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
    </div>
  </header>

  <main class="login">
    <div class="login__card">
      <h1 class="login__title">Sign in to start a session</h1>
      <p class="login__lede">
        Your session data stays on this device. No account is required to browse
        the landing page.
      </p>

      <?php if ($info): ?>
        <p class="form-info"><?= e($info) ?></p>
      <?php endif; ?>
      <?php if ($error): ?>
        <p class="form-error" role="alert"><?= e($error) ?></p>
      <?php endif; ?>

      <form class="login__form" id="loginForm" method="POST">
        <label class="field">
          <span class="field__label">Username</span>
          <input class="field__input" type="text" name="username"
                 autocomplete="username" placeholder="e.g. patient_demo" required />
        </label>

        <label class="field">
          <span class="field__label">Password</span>
          <input class="field__input" type="password" name="password"
                 autocomplete="current-password" placeholder="••••••••" required />
        </label>

        <button type="submit" class="btn btn--primary btn--block">
          Continue to exercise session
        </button>
      </form>

      <p class="login__back">
        Don't have an account? <a href="register.php">Create one</a>
      </p>
    </div>
  </main>

</body>
</html>