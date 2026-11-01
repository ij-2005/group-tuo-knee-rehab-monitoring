# Knee Rehab Monitoring System

An AI-powered, computer-vision-based tool for monitoring knee rehabilitation
exercises in real time. The system uses MediaPipe Pose Estimation to detect
lower-body landmarks through a webcam, calculates knee joint angles, and
provides live feedback — all entirely in the browser, with no video ever
leaving the device.

This is a **prototype** developed for academic purposes. It is **not a
medical device**, and it does not diagnose, treat, or replace professional
medical advice.

---

# How to use -ivan:

1. cd to GroupTUO
2. enter php -S localhost:8000, you will see (PHP Development Server (http://localhost:8000) started)
3. http://localhost:8000/landingpage.html = proceed to login, dapat gumagana na yung php files.
4. Ctrl + C para mastop yung server.

# OTP Mechanics

1. Go to http://localhost:8000/register.php → create an account
2. Go to http://localhost:8000/login.php → sign in
3. Press F12 → Console tab to see the demo OTP
4. Enter the OTP on the verify page
5. Diretso na to papuntang (app.php)

# Users and Authlog

1. users.json and auth.log are created automatically on first use.
2. To reset everything: stop the server, delete users.json and auth.log, restart.