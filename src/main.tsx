import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Handle EVE Online OAuth2 PKCE popup callback on the exact current app URL
// (window.location.origin + window.location.pathname) so zero-terminal setups
// work seamlessly without requiring a separate /auth/callback path.
const params = new URLSearchParams(window.location.search);
const ssoCode = params.get('code');
const ssoState = params.get('state');
const ssoError = params.get('error');

if ((ssoCode || ssoError) && ssoState && window.opener) {
  try {
    window.opener.postMessage(
      {
        type: 'EVE_SSO_CALLBACK',
        code: ssoCode || '',
        state: ssoState,
        error: ssoError || '',
      },
      window.location.origin
    );
  } catch {
    // Fallback if opener origin differs during proxied preview
    window.opener.postMessage(
      {
        type: 'EVE_SSO_CALLBACK',
        code: ssoCode || '',
        state: ssoState,
        error: ssoError || '',
      },
      '*'
    );
  }
  window.setTimeout(() => window.close(), 150);
} else {
  createRoot(document.getElementById('root')!).render(<App />);
}
