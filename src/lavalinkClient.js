/**
 * Lavalink v4 REST API Client
 * Handles all HTTP communication with the Lavalink node
 */

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

  /**
   * Generic fetch wrapper with error handling
   */
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

  /**
   * GET /v4/stats
   * Returns Lavalink server statistics
   */
  async getStats() {
    return this._request('/v4/stats');
  }

  /**
   * GET /v4/info
   * Returns server version and build info
   */
  async getInfo() {
    return this._request('/v4/info');
  }

  /**
   * GET /v4/sessions/{sessionId}/players
   * Returns all players for a given session
   */
  async getPlayers(sessionId) {
    if (!sessionId) return [];
    return this._request(`/v4/sessions/${sessionId}/players?trace=false`);
  }
}
