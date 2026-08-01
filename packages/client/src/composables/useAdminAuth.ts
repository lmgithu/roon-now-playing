import { ref } from 'vue';

const TOKEN_KEY = 'roon-admin-token';

const authChecked = ref(false);
const authRequired = ref(false);
const authenticated = ref(false);
const authError = ref<string | null>(null);

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode */
  }
}

/** fetch() with admin Bearer token when present */
export async function adminFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = getAdminToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init.body && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, { ...init, headers });
}

export function useAdminAuth() {
  async function checkStatus(): Promise<void> {
    authError.value = null;
    try {
      const res = await fetch('/api/admin/auth/status');
      if (!res.ok) {
        authRequired.value = false;
        authenticated.value = true;
        authChecked.value = true;
        return;
      }
      const data = (await res.json()) as { required: boolean };
      authRequired.value = !!data.required;

      if (!authRequired.value) {
        authenticated.value = true;
        authChecked.value = true;
        return;
      }

      const token = getAdminToken();
      if (!token) {
        authenticated.value = false;
        authChecked.value = true;
        return;
      }

      // Probe a protected endpoint to validate session
      const probe = await adminFetch('/api/admin/display-settings');
      if (probe.ok) {
        authenticated.value = true;
      } else {
        setAdminToken(null);
        authenticated.value = false;
      }
    } catch (err) {
      console.error('Admin auth status failed', err);
      // Fail open for local UX if status endpoint unreachable during dev
      authRequired.value = false;
      authenticated.value = true;
    } finally {
      authChecked.value = true;
    }
  }

  async function login(password: string): Promise<boolean> {
    authError.value = null;
    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        authError.value = data.error || 'Invalid password';
        authenticated.value = false;
        return false;
      }
      setAdminToken(data.token);
      authenticated.value = true;
      authRequired.value = true;
      return true;
    } catch {
      authError.value = 'Login failed';
      return false;
    }
  }

  async function logout(): Promise<void> {
    try {
      await adminFetch('/api/admin/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setAdminToken(null);
    if (authRequired.value) {
      authenticated.value = false;
    }
  }

  async function setPassword(
    password: string,
    currentPassword?: string
  ): Promise<{ ok: true; token?: string } | { ok: false; error: string }> {
    try {
      const res = await adminFetch('/api/admin/auth/password', {
        method: 'POST',
        body: JSON.stringify({ password, currentPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        token?: string;
        required?: boolean;
        error?: string;
      };
      if (!res.ok) {
        return { ok: false, error: data.error || 'Failed to update password' };
      }
      if (data.token) {
        setAdminToken(data.token);
        authenticated.value = true;
        authRequired.value = true;
        return { ok: true, token: data.token };
      }
      // Cleared
      setAdminToken(null);
      authRequired.value = false;
      authenticated.value = true;
      return { ok: true };
    } catch {
      return { ok: false, error: 'Failed to update password' };
    }
  }

  return {
    authChecked,
    authRequired,
    authenticated,
    authError,
    checkStatus,
    login,
    logout,
    setPassword,
    getAdminToken,
    adminFetch,
  };
}
