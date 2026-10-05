<?php
/**
 * TayabasCare HTML Email Template
 * 
 * Renders a branded HTML email wrapper with inline CSS for maximum
 * email-client compatibility (Gmail, Outlook, Apple Mail, Yahoo).
 * 
 * Usage:
 *   require_once __DIR__ . '/email_template.php';
 *   $html = renderEmailTemplate('Password Reset', $contentHTML, '#dc2626');
 *   $mail->Body = $html;
 *   $mail->AltBody = strip_tags($contentHTML); // plaintext fallback
 */

/**
 * @param string $title     - Preheader / accent heading text
 * @param string $content   - Inner HTML content (already escaped)
 * @param string $accentColor - Hex color for the accent bar (default: blue)
 * @return string            - Complete HTML email body
 */
function renderEmailTemplate($title, $content, $accentColor = '#1e40af') {
    $year = date('Y');

    return '<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>' . htmlspecialchars($title) . ' - TayabasCare</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:\'Segoe UI\',Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

<!-- Outer wrapper -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;">
    <tr>
        <td align="center" style="padding:32px 16px;">

            <!-- Email container -->
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.07);">

                <!-- Header -->
                <tr>
                    <td style="background-color:#1e40af;padding:28px 40px;text-align:center;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                                <td align="center">
                                    <span style="font-size:26px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">TayabasCare</span>
                                    <br>
                                    <span style="font-size:13px;color:#93c5fd;letter-spacing:0.3px;">City Health Office &bull; Tayabas City</span>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>

                <!-- Accent bar -->
                <tr>
                    <td style="height:4px;background-color:' . $accentColor . ';"></td>
                </tr>

                <!-- Title section -->
                <tr>
                    <td style="padding:32px 40px 0 40px;">
                        <h1 style="margin:0;font-size:20px;font-weight:700;color:#1e293b;line-height:1.3;">' . htmlspecialchars($title) . '</h1>
                    </td>
                </tr>

                <!-- Divider -->
                <tr>
                    <td style="padding:16px 40px 0 40px;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                                <td style="border-bottom:1px solid #e2e8f0;"></td>
                            </tr>
                        </table>
                    </td>
                </tr>

                <!-- Content -->
                <tr>
                    <td style="padding:24px 40px 32px 40px;font-size:15px;line-height:1.7;color:#334155;">
                        ' . $content . '
                    </td>
                </tr>

            </table>
            <!-- End email container -->

            <!-- Footer -->
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
                <tr>
                    <td style="padding:20px 40px;text-align:center;">
                        <p style="margin:0 0 6px 0;font-size:12px;color:#94a3b8;">
                            City Health Office &bull; Tayabas City, Quezon Province
                        </p>
                        <p style="margin:0;font-size:12px;color:#cbd5e1;">
                            This is an automated message from the TayabasCare System. Please do not reply directly to this email.
                        </p>
                        <p style="margin:8px 0 0 0;font-size:11px;color:#cbd5e1;">
                            &copy; ' . $year . ' TayabasCare. All rights reserved.
                        </p>
                    </td>
                </tr>
            </table>
            <!-- End footer -->

        </td>
    </tr>
</table>
<!-- End outer wrapper -->

</body>
</html>';
}

/**
 * Render a styled info-row (label: value) for email content.
 */
function emailInfoRow($label, $value) {
    return '<tr>'
        . '<td style="padding:6px 0;font-size:14px;color:#64748b;white-space:nowrap;padding-right:16px;vertical-align:top;width:120px;">' . htmlspecialchars($label) . ':</td>'
        . '<td style="padding:6px 0;font-size:14px;color:#1e293b;font-weight:600;">' . htmlspecialchars($value) . '</td>'
        . '</tr>';
}

/**
 * Render a styled list item for compliance/violation lists.
 */
function emailListItem($text, $icon = '&#9679;') {
    return '<tr>'
        . '<td style="padding:5px 0;font-size:14px;color:#334155;padding-left:8px;">'
        . '<span style="color:#1e40af;margin-right:8px;">' . $icon . '</span> '
        . htmlspecialchars($text)
        . '</td>'
        . '</tr>';
}
