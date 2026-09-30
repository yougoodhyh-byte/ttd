import { SUPABASE_URL, PUBLISHABLE_KEY } from './config.js';
export const SESSION_KEY = 'ttd.private.session.v1';
export class CloudError extends Error {
  constructor(message, status = 0, code = '') { super(message); this.status = status; this.code = code; }
}
export class Cloud {
  readSession() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      return value?.access_token && value?.refresh_token ? value : null;
    } catch { return null; }
  }
  writeSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      ...session, expires_at: session.expires_at || Math.floor(Date.now() / 1000) + session.expires_in,
    }));
  }
  async raw(path, { method = 'GET', body, token, headers = {}, timeout = 30000 } = {}) {
    let response;
    try {
      response = await fetch(SUPABASE_URL + path, {
        method, cache: 'no-store', credentials: 'omit',
        headers: { apikey: PUBLISHABLE_KEY, ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout),
      });
    } catch { throw new CloudError('网络连接失败或请求超时。本次修改尚未同步，请保留编辑窗口后重试。'); }
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { throw new CloudError('云端返回异常，请重试。', response.status); }
    if (!response.ok) throw new CloudError(data?.error_description || data?.msg || data?.message || data?.error || '云端请求失败', response.status, data?.code || '');
    return data;
  }
  async refresh(force = false) {
    const task = async () => {
      let session = this.readSession();
      if (!session) throw new CloudError('请重新登录。', 401);
      if (!force && session.expires_at > Date.now() / 1000 + 90) return session;
      const oldRefresh = session.refresh_token;
      try {
        session = await this.raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: oldRefresh } });
      } catch (error) {
        if (error.status === 400 || error.status === 401) {
          if (this.readSession()?.refresh_token === oldRefresh) localStorage.removeItem(SESSION_KEY);
        }
        throw error;
      }
      // A logout in another tab must not be undone by an in-flight refresh.
      if (this.readSession()?.refresh_token !== oldRefresh) throw new CloudError('登录状态已改变，请重新登录。', 401);
      this.writeSession(session);
      return session;
    };
    return navigator.locks ? navigator.locks.request(SESSION_KEY, task) : (this.refreshing ||= task().finally(() => { this.refreshing = null; }));
  }
  async request(path, options = {}) {
    let session = await this.refresh();
    try { return await this.raw(path, { ...options, token: session.access_token }); }
    catch (error) {
      if (error.status !== 401) throw error;
      session = await this.refresh(true);
      return this.raw(path, { ...options, token: session.access_token });
    }
  }
  async signIn(email, password) {
    const session = await this.raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    this.writeSession(session);
  }
  user() { return this.request('/auth/v1/user'); }
  async signOut() {
    const old = this.readSession();
    localStorage.removeItem(SESSION_KEY);
    if (old) await this.raw('/auth/v1/logout?scope=local', { method: 'POST', token: old.access_token });
  }
  async page(metadataOnly = false) {
    const fields = metadataOnly ? 'version,updated_at' : 'id,title,body,version,updated_at';
    const rows = await this.request('/rest/v1/ttd_pages?id=eq.homepage&select=' + fields);
    if (!rows?.length) throw new CloudError('此账号没有这份主页的访问权限，请使用主页绑定的账号登录。', 403);
    return rows[0];
  }
  async save(body, title, version) {
    const rows = await this.request('/rest/v1/ttd_pages?id=eq.homepage&version=eq.' + encodeURIComponent(version), {
      method: 'PATCH', body: { body, title }, headers: { Prefer: 'return=representation' },
    });
    if (rows?.length !== 1) throw new CloudError('另一台设备已经更新了主页。为防止覆盖，本次未保存；请复制当前编辑内容，再重新加载云端版本。', 409, 'conflict');
    return rows[0];
  }
  translate(body) { return this.request('/functions/v1/ttd-translate', { method: 'POST', body, timeout: 60000 }); }
}
