export class LavalinkClient {
  constructor(config) {
    this.host = config.host;
    this.port = config.port;
    this.password = config.password;
    this.secure = config.secure ?? false;
    this.baseUrl = `${this.secure ? 'https' : 'http'}://${this.host}:${this.port}`;
    this.headers = {
      Authorization: this.password,
      'Content-Type': 'application/json',
    };
  }

  async _request(endpoint) {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(url, {
        headers: this.headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body}`);
      }

      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Request timed out after 5s');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getStats() {
    return this._request('/v4/stats');
  }

  async getInfo() {
    return this._request('/v4/info');
  }

  async getPlayers(sessionId) {
    if (!sessionId) return [];
    return this._request(`/v4/sessions/${sessionId}/players?trace=false`);
  }
}

// Made with <3 by dev @karma.ly
