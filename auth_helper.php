<?php
// auth_helper.php — shared utilities for IA controls

session_start();

define('USERS_FILE', __DIR__ . '/users.json');
define('LOG_FILE',   __DIR__ . '/auth.log');

function load_users() {
    if (!file_exists(USERS_FILE)) return [];
    $json = file_get_contents(USERS_FILE);
    return json_decode($json, true) ?: [];
}

function save_users($users) {
    file_put_contents(USERS_FILE, json_encode($users, JSON_PRETTY_PRINT));
}

function log_event($message) {
    $line = date('Y-m-d H:i:s') . " | " . $message . PHP_EOL;
    file_put_contents(LOG_FILE, $line, FILE_APPEND);
}

function require_login() {
    if (empty($_SESSION['logged_in'])) {
        header('Location: login.php');
        exit;
    }
}

function e($s) { return htmlspecialchars($s ?? '', ENT_QUOTES, 'UTF-8'); }