/**
 * Generate a VAPID key pair for Web Push.
 *
 * Prints them for you to paste into `.env`. Deliberately does not write the
 * file: a private key is a secret, and a script that edits your environment
 * behind you is a script that will one day overwrite something you wanted.
 *
 * Run once. Regenerating invalidates every existing push subscription, because
 * a subscription is bound to the key it was created with.
 */

import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`
Add these to .env, and never commit them:

# Public. Shipped to the browser, which is why it carries the NEXT_PUBLIC_ prefix.
NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}

# Private. Server only. Anyone holding this can send notifications as you.
VAPID_PRIVATE_KEY=${privateKey}

# How a push service reaches you about a problem with your pushes.
VAPID_SUBJECT=mailto:you@example.com
`);
