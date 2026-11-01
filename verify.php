<?php
require 'auth_helper.php';

if (empty($_SESSION['pending_user']) || empty($_SESSION['otp'])) {
    header('Location: login.php');
    exit;
}

$error   = '';
$expired = false;
$locked  = false;
$elapsed = time() - $_SESSION['otp_time'];

if ($elapsed > 300) {
    $error   = 'OTP expired. Please sign in again.';
    $expired = true;
    log_event("OTP EXPIRED: {$_SESSION['pending_user']}");
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$error) {
    $entered = trim($_POST['otp'] ?? '');
    $_SESSION['otp_attempts']++;

    if ($_SESSION['otp_attempts'] > 5) {
        $error  = 'Too many attempts. Please sign in again.';
        $locked = true;
        log_event("OTP LOCKOUT: {$_SESSION['pending_user']}");
    } elseif (hash_equals((string)$_SESSION['otp'], $entered)) {
        session_regenerate_id(true);
        $_SESSION['logged_in'] = true;
        $_SESSION['user']      = $_SESSION['pending_user'];
        unset($_SESSION['otp'], $_SESSION['otp_time'], $_SESSION['otp_attempts'],
              $_SESSION['otp_demo_display'], $_SESSION['pending_user']);
        log_event("LOGIN step2 OK: {$_SESSION['user']} (2FA passed)");
        header('Location: app.php');
        exit;
    } else {
        $error = 'Incorrect OTP. Attempt ' . $_SESSION['otp_attempts'] . ' of 5.';
        log_event("OTP FAIL: {$_SESSION['pending_user']} attempt {$_SESSION['otp_attempts']}");
    }
}

$demoOtp = !empty($_SESSION['otp_demo_display']) ? $_SESSION['otp'] : null;
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verify OTP — Knee Rehab Monitoring</title>
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
      <h1 class="login__title">Two-factor verification</h1>
      <p class="login__lede">
        Enter the 6-digit code to complete sign-in.
      </p>

      <?php if (!$expired && !$locked && $error !== ''): ?>
        <p class="form-error" role="alert"><?= e($error) ?></p>
      <?php endif; ?>

      <?php if (!$expired && !$locked): ?>
      <form class="login__form" method="POST">
        <label class="field">
          <span class="field__label">OTP code</span>
          <input class="field__input" type="text" name="otp"
                 inputmode="numeric" pattern="[0-9]{6}" maxlength="6"
                 placeholder="123456" required autofocus />
        </label>
        <button type="submit" class="btn btn--primary btn--block">Verify</button>
      </form>
      <?php endif; ?>

      <p class="login__back"><a href="login.php">← Back to sign in</a></p>
    </div>
  </main>

<?php if ($demoOtp): ?>
<script>
  console.log(
    "%cOTP code Demo: %c" + "<?= e($demoOtp) ?>",
    "color:#00703C;font-weight:bold;",
    "color:#F2A900;font-weight:bold;font-size:16px;letter-spacing:4px;"
  );
  console.log("%c(Demo prototype palang to so di ko muna cinonsider email/SMS — since for development purposes palang ito -ivan.)",
              "color:#888;font-style:italic;");
</script>
<?php endif; ?>

</body>
</html>