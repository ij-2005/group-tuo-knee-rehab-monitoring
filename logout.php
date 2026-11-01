<?php
require 'auth_helper.php';
$u = $_SESSION['user'] ?? 'unknown';
log_event("LOGOUT: $u");
session_destroy();
header('Location: landingpage.html');
exit;