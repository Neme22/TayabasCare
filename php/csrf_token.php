<?php
require_once 'config.php';
require_once 'csrf.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    errorResponse('Method not allowed', 405);
}

jsonResponse(true, ['token' => csrfToken()], 'CSRF token');
