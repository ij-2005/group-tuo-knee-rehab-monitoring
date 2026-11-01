<?php
require 'auth_helper.php';

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';
    $confirm  = $_POST['confirmPassword'] ?? '';

    if ($username === '' || strlen($password) < 8) {
        $error = 'Username required and password must be at least 8 characters.';
    } elseif ($password !== $confirm) {
        $error = 'Passwords do not match.';
    } else {
        $users = load_users();
        if (isset($users[$username])) {
            $error = 'Username already exists.';
        } else {
            $users[$username] = [
                'password_hash' => password_hash($password, PASSWORD_DEFAULT),
                'created_at'    => date('c'),
            ];
            save_users($users);
            log_event("REGISTER success: $username");
            header('Location: login.php?registered=1');
            exit;
        }
    }
    log_event("REGISTER fail: $username — $error");
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Create Account — Knee Rehab Monitoring</title>
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
      <h1 class="login__title">Create an account</h1>
      <p class="login__lede">
        Set up a local account to save your exercise sessions on this device.
        Your data stays on your computer.
      </p>

      <?php if ($error): ?>
        <p class="form-error" role="alert"><?= e($error) ?></p>
      <?php endif; ?>

      <form class="login__form" id="registerForm" method="POST" novalidate>
        <label class="field">
          <span class="field__label">Username</span>
          <input class="field__input" type="text" name="username"
                 autocomplete="username" placeholder="e.g. patient_demo" required />
        </label>

        <label class="field">
          <span class="field__label">Password</span>
          <input class="field__input" type="password" name="password"
                 autocomplete="new-password" placeholder="At least 8 characters"
                 minlength="8" required />
        </label>

        <label class="field">
          <span class="field__label">Confirm password</span>
          <input class="field__input" type="password" name="confirmPassword"
                 autocomplete="new-password" placeholder="Re-enter your password"
                 minlength="8" required />
        </label>

        <button type="submit" class="btn btn--primary btn--block">
          Create account
        </button>
      </form>

      <p class="login__back">
        Already have an account? <a href="login.php">Sign in</a>
      </p>
    </div>
  </main>

</body>
</html>